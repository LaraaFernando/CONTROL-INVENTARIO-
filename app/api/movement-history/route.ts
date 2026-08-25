import { env } from "cloudflare:workers";
import { ensureOperationalSchema } from "../../../db/operations";
import { AuthError, requireUser } from "../../auth";

type MovementHistoryRow = {
  id: number;
  type: string;
  quantity: number;
  delta: number;
  reference: string;
  notes: string;
  performedBy: string;
  voided: number;
  voidedBy: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
  productId: number;
  productName: string;
  sku: string;
  clientName: string | null;
  unitAmount: number;
  totalAmount: number;
  requestedQuantity: number;
  pendingQuantity: number;
  presentation: string;
  presentationFactor: number;
  businessDate: string;
  sourceType: string;
  sourceId: number | null;
};

function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "No se pudo cargar el historial de movimientos." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();

    const result = await env.DB.prepare(`
      SELECT
        m.id,
        m.type,
        m.quantity,
        m.delta,
        m.reference,
        m.notes,
        m.performed_by AS performedBy,
        m.voided,
        m.voided_by AS voidedBy,
        m.voided_at AS voidedAt,
        m.void_reason AS voidReason,
        m.created_at AS createdAt,
        m.product_id AS productId,
        p.name AS productName,
        p.sku,
        c.name AS clientName,
        m.unit_amount AS unitAmount,
        m.total_amount AS totalAmount,
        m.requested_quantity AS requestedQuantity,
        m.pending_quantity AS pendingQuantity,
        m.presentation,
        m.presentation_factor AS presentationFactor,
        COALESCE(NULLIF(m.business_date, ''), SUBSTR(m.created_at, 1, 10)) AS businessDate,
        COALESCE(m.source_type, '') AS sourceType,
        m.source_id AS sourceId
      FROM movements m
      INNER JOIN products p ON p.id = m.product_id
      LEFT JOIN clients c ON c.id = m.client_id
      ORDER BY m.id DESC
      LIMIT 500
    `).all<MovementHistoryRow>();

    return Response.json({
      rows: (result.results ?? []).map((row) => ({
        ...row,
        id: Number(row.id),
        productId: Number(row.productId),
        quantity: Number(row.quantity || 0),
        delta: Number(row.delta || 0),
        voided: Number(row.voided || 0),
        unitAmount: Number(row.unitAmount || 0),
        totalAmount: Number(row.totalAmount || 0),
        requestedQuantity: Number(row.requestedQuantity || 0),
        pendingQuantity: Number(row.pendingQuantity || 0),
        presentationFactor: Number(row.presentationFactor || 1),
        sourceId: row.sourceId == null ? null : Number(row.sourceId),
      })),
      canDelete: Boolean(user.permissions["movements.delete"]),
      canAudit: Boolean(user.permissions["audit.view"]),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
