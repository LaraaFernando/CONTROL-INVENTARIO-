import { env } from "cloudflare:workers";
import { ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { ensureSaleTrackingSchema } from "../../sale-tracking";

type DeliveryStatus = "preparando" | "transito" | "entregada";

type DeliveryRow = {
  saleId: number;
  reference: string;
  clientName: string;
  totalAmount: number;
  businessDate: string;
  createdAt: string;
  lineCount: number;
  status: DeliveryStatus;
  inTransitAt: string | null;
  deliveredAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la entrega." }, { status: 500 });
}

async function ensureDeliverySchema() {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sale_delivery_status (
        sale_reference TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'preparando',
        in_transit_at TEXT,
        delivered_at TEXT,
        updated_by_user_id INTEGER,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sale_delivery_status_state ON sale_delivery_status(status, updated_at)"),
  ]);
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    await ensureOperationalSchema();
    await ensureSaleTrackingSchema();
    await ensureDeliverySchema();

    const result = await env.DB.prepare(`
      SELECT
        s.id AS saleId,
        s.folio AS reference,
        c.name AS clientName,
        s.total_amount AS totalAmount,
        s.business_date AS businessDate,
        s.created_at AS createdAt,
        COUNT(m.id) AS lineCount,
        COALESCE(d.status, 'preparando') AS status,
        d.in_transit_at AS inTransitAt,
        d.delivered_at AS deliveredAt,
        d.updated_at AS updatedAt,
        NULLIF(d.updated_by, '') AS updatedBy
      FROM sales s
      INNER JOIN clients c ON c.id = s.client_id
      INNER JOIN movements m
        ON m.reference = s.folio
        AND m.type = 'venta'
        AND COALESCE(m.voided, 0) = 0
      LEFT JOIN sale_delivery_status d ON d.sale_reference = s.folio
      GROUP BY s.id, s.folio, c.name, s.total_amount, s.business_date, s.created_at,
        d.status, d.in_transit_at, d.delivered_at, d.updated_at, d.updated_by
      ORDER BY s.id DESC
      LIMIT 100
    `).all<DeliveryRow>();

    const deliveries = (result.results ?? []).map((row) => ({
      ...row,
      saleId: Number(row.saleId),
      totalAmount: Number(row.totalAmount || 0),
      lineCount: Number(row.lineCount || 0),
      status: (row.status || "preparando") as DeliveryStatus,
    }));

    return Response.json({
      deliveries,
      summary: {
        preparing: deliveries.filter((row) => row.status === "preparando").length,
        inTransit: deliveries.filter((row) => row.status === "transito").length,
        delivered: deliveries.filter((row) => row.status === "entregada").length,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "movements.sale");
    await ensureOperationalSchema();
    await ensureSaleTrackingSchema();
    await ensureDeliverySchema();

    const body = await request.json() as Record<string, unknown>;
    const reference = text(body.reference).toUpperCase();
    const nextStatus = text(body.status).toLowerCase() as DeliveryStatus;
    const completeConfirmed = body.completeConfirmed === true;

    if (!reference) throw new AuthError("Falta el folio de la venta.", 400);
    if (!(["transito", "entregada"] as string[]).includes(nextStatus)) {
      throw new AuthError("El estado de entrega no es válido.", 400);
    }

    const sale = await env.DB.prepare(`
      SELECT s.id, s.folio
      FROM sales s
      WHERE s.folio = ?
        AND EXISTS (
          SELECT 1 FROM movements m
          WHERE m.reference = s.folio
            AND m.type = 'venta'
            AND COALESCE(m.voided, 0) = 0
        )
      LIMIT 1
    `).bind(reference).first<{ id: number; folio: string }>();
    if (!sale) throw new AuthError("La venta no existe o ya fue anulada.", 404);

    const current = await env.DB.prepare(`
      SELECT status, in_transit_at AS inTransitAt, delivered_at AS deliveredAt,
        updated_by AS updatedBy, updated_at AS updatedAt
      FROM sale_delivery_status WHERE sale_reference = ? LIMIT 1
    `).bind(reference).first<{
      status: DeliveryStatus;
      inTransitAt: string | null;
      deliveredAt: string | null;
      updatedBy: string;
      updatedAt: string;
    }>();

    const currentStatus: DeliveryStatus = current?.status || "preparando";
    if (nextStatus === currentStatus) return Response.json({ ok: true, reference, status: currentStatus });

    if (nextStatus === "transito" && currentStatus !== "preparando") {
      throw new AuthError("Solo una venta en preparación puede marcarse como en tránsito.", 409);
    }
    if (nextStatus === "entregada" && currentStatus !== "transito") {
      throw new AuthError("Primero marca la venta como en tránsito.", 409);
    }
    if (nextStatus === "entregada" && !completeConfirmed) {
      throw new AuthError("Confirma que el cliente recibió completa la mercancía antes de marcar la venta como entregada.", 400);
    }

    await env.DB.prepare(`
      INSERT INTO sale_delivery_status
        (sale_reference, status, in_transit_at, delivered_at, updated_by_user_id, updated_by, updated_at)
      VALUES (
        ?, ?,
        CASE WHEN ? = 'transito' THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN ? = 'entregada' THEN CURRENT_TIMESTAMP ELSE NULL END,
        ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(sale_reference) DO UPDATE SET
        status = excluded.status,
        in_transit_at = CASE
          WHEN excluded.status = 'transito' THEN CURRENT_TIMESTAMP
          ELSE sale_delivery_status.in_transit_at
        END,
        delivered_at = CASE
          WHEN excluded.status = 'entregada' THEN CURRENT_TIMESTAMP
          ELSE sale_delivery_status.delivered_at
        END,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).bind(reference, nextStatus, nextStatus, nextStatus, user.id, user.displayName).run();

    await recordAudit({
      entityType: "sale_delivery",
      entityId: Number(sale.id),
      action: "cambiar_estado",
      user,
      before: { reference, status: currentStatus, ...current },
      after: {
        reference,
        status: nextStatus,
        completeConfirmed: nextStatus === "entregada" ? true : undefined,
      },
    });

    return Response.json({ ok: true, reference, status: nextStatus });
  } catch (error) {
    return errorResponse(error);
  }
}
