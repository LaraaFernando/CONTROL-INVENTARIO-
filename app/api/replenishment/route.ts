import { env } from "cloudflare:workers";
import { businessDate, ensureOperationalSchema } from "../../../db/operations";
import { AuthError, requireUser } from "../../auth";

type StockRow = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  targetStock: number;
  sold30: number;
};

type AttentionStatus = "agotado" | "bajo_minimo" | "proximo_minimo";

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "No se pudo calcular el reabastecimiento." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();

    const today = businessDate();
    const startDate = addDays(today, -29);
    const result = await env.DB.prepare(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p.unit,
        p.current_stock AS currentStock,
        p.minimum_stock AS minimumStock,
        p.target_stock AS targetStock,
        COALESCE(SUM(
          CASE
            WHEN m.type = 'venta'
              AND COALESCE(m.voided, 0) = 0
              AND COALESCE(NULLIF(m.business_date, ''), SUBSTR(m.created_at, 1, 10)) >= ?
              AND COALESCE(NULLIF(m.business_date, ''), SUBSTR(m.created_at, 1, 10)) <= ?
            THEN ABS(m.delta)
            ELSE 0
          END
        ), 0) AS sold30
      FROM products p
      LEFT JOIN movements m ON m.product_id = p.id
      WHERE COALESCE(p.active, 1) = 1
      GROUP BY p.id, p.sku, p.name, p.category, p.unit, p.current_stock, p.minimum_stock, p.target_stock
      ORDER BY p.name
    `).bind(startDate, today).all<StockRow>();

    const attention = (result.results ?? []).flatMap((row) => {
      const currentStock = Number(row.currentStock || 0);
      const minimumStock = Math.max(0, Number(row.minimumStock || 0));
      const targetStock = Math.max(minimumStock, Number(row.targetStock || 0));
      const sold30 = Math.max(0, Number(row.sold30 || 0));
      const averageDailySales = sold30 / 30;
      const daysToMinimum = averageDailySales > 0 && currentStock > minimumStock
        ? (currentStock - minimumStock) / averageDailySales
        : null;

      let status: AttentionStatus | null = null;
      if (currentStock <= 0) status = "agotado";
      else if (currentStock <= minimumStock) status = "bajo_minimo";
      else if (daysToMinimum !== null && daysToMinimum <= 14) status = "proximo_minimo";

      if (!status) return [];

      return [{
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category || "General",
        unit: row.unit,
        currentStock,
        minimumStock,
        targetStock,
        sold30,
        averageDailySales,
        daysToMinimum,
        suggestedOrder: Math.max(0, targetStock - currentStock),
        status,
      }];
    }).sort((left, right) => {
      const severity: Record<AttentionStatus, number> = {
        agotado: 3,
        bajo_minimo: 2,
        proximo_minimo: 1,
      };
      const byStatus = severity[right.status] - severity[left.status];
      if (byStatus) return byStatus;
      const leftDays = left.daysToMinimum ?? Number.POSITIVE_INFINITY;
      const rightDays = right.daysToMinimum ?? Number.POSITIVE_INFINITY;
      if (leftDays !== rightDays) return leftDays - rightDays;
      return left.currentStock - right.currentStock;
    });

    return Response.json({
      calculatedAt: today,
      windowStart: startDate,
      attention,
      summary: {
        outOfStock: attention.filter((item) => item.status === "agotado").length,
        belowMinimum: attention.filter((item) => item.status === "bajo_minimo").length,
        approachingMinimum: attention.filter((item) => item.status === "proximo_minimo").length,
      },
      canManageOrders: Boolean(user.permissions["orders.manage"]),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
