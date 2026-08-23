import { env } from "cloudflare:workers";
import { businessDate, ensureOperationalSchema } from "../../../db/operations";
import { AuthError, requireUser } from "../../auth";

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo calcular el reporte." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const today = businessDate();
    const startDate = addDays(today, -29);

    const [summary, productRows, activeCount, inventoryValue] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type='venta' AND voided=0 THEN total_amount ELSE 0 END),0) AS salesAmount,
          COALESCE(SUM(CASE WHEN type='venta' AND voided=0 THEN ABS(delta) ELSE 0 END),0) AS unitsSold,
          COUNT(DISTINCT CASE WHEN type='venta' AND voided=0 THEN product_id END) AS productsSold
        FROM movements
        WHERE COALESCE(NULLIF(business_date,''),substr(created_at,1,10)) BETWEEN ? AND ?
      `).bind(startDate, today).first<{salesAmount:number;unitsSold:number;productsSold:number}>(),
      env.DB.prepare(`
        SELECT p.id,p.sku,p.name,p.category,p.unit,p.current_stock AS currentStock,p.minimum_stock AS minimumStock,
          COALESCE(SUM(CASE WHEN m.type='venta' AND m.voided=0 AND COALESCE(NULLIF(m.business_date,''),substr(m.created_at,1,10)) BETWEEN ? AND ? THEN ABS(m.delta) ELSE 0 END),0) AS sold30,
          COALESCE(SUM(CASE WHEN m.type='venta' AND m.voided=0 AND COALESCE(NULLIF(m.business_date,''),substr(m.created_at,1,10)) BETWEEN ? AND ? THEN m.total_amount ELSE 0 END),0) AS sales30,
          MAX(CASE WHEN m.type='venta' AND m.voided=0 THEN COALESCE(NULLIF(m.business_date,''),substr(m.created_at,1,10)) ELSE NULL END) AS lastSaleDate
        FROM products p
        LEFT JOIN movements m ON m.product_id=p.id
        WHERE p.active=1
        GROUP BY p.id,p.sku,p.name,p.category,p.unit,p.current_stock,p.minimum_stock
        ORDER BY sales30 DESC,sold30 DESC,p.name
      `).bind(startDate,today,startDate,today).all<{id:number;sku:string;name:string;category:string;unit:string;currentStock:number;minimumStock:number;sold30:number;sales30:number;lastSaleDate:string|null}>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE active=1").first<{count:number}>(),
      user.permissions["products.view_cost"]
        ? env.DB.prepare("SELECT COALESCE(SUM(current_stock*cost),0) AS value FROM products WHERE active=1").first<{value:number}>()
        : Promise.resolve(null),
    ]);

    const rows = (productRows.results ?? []).map((row) => {
      const sold30 = Number(row.sold30 || 0);
      const currentStock = Math.max(0, Number(row.currentStock || 0));
      const daily = sold30 / 30;
      const daysCover = daily > 0 ? currentStock / daily : null;
      let rotation: "alta" | "media" | "baja" | "sin_movimiento" = "sin_movimiento";
      if (sold30 > 0 && (daysCover ?? 0) <= 30) rotation = "alta";
      else if (sold30 > 0 && (daysCover ?? 0) <= 90) rotation = "media";
      else if (sold30 > 0) rotation = "baja";
      return {
        ...row,
        currentStock,
        sold30,
        sales30: Number(row.sales30 || 0),
        daysCover,
        rotation,
      };
    });

    const activeProducts = Number(activeCount?.count || 0);
    const noMovement = rows.filter((row) => row.sold30 === 0 && row.currentStock > 0);
    const topProducts = rows.filter((row) => row.sold30 > 0).slice(0, 8);
    const lowRotation = rows.filter((row) => row.rotation === "baja" || row.rotation === "sin_movimiento").slice(0, 12);

    return Response.json({
      today,
      startDate,
      summary: {
        salesAmount30: Number(summary?.salesAmount || 0),
        unitsSold30: Number(summary?.unitsSold || 0),
        productsSold30: Number(summary?.productsSold || 0),
        activeProducts,
        noMovement30: noMovement.length,
        inventoryValue: inventoryValue ? Number(inventoryValue.value || 0) : null,
      },
      rotation: {
        high: rows.filter((row) => row.rotation === "alta").length,
        medium: rows.filter((row) => row.rotation === "media").length,
        low: rows.filter((row) => row.rotation === "baja").length,
        none: rows.filter((row) => row.rotation === "sin_movimiento").length,
      },
      topProducts,
      lowRotation,
    });
  } catch (error) { return errorResponse(error); }
}
