import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, ensureOperationalSchema, recordAudit } from "../../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../../auth";
import { ensureFieldOrderSchema } from "../../../field-order-schema";
import { ensureSaleTrackingSchema } from "../../../sale-tracking";

type TargetMovement = {
  id: number;
  type: string;
  productId: number;
  clientId: number | null;
  reference: string;
  delta: number;
  voided: number;
  businessDate: string;
};

type RelatedMovement = {
  id: number;
  type: string;
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
  delta: number;
  totalAmount: number;
  currentStock: number;
};

type LinkedFieldOrder = { id: number; folio: string; status: string };
type RemainingSaleSummary = { lineCount: number; totalAmount: number };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "No se pudo anular el producto de la venta.";
  if (message.includes("UNIQUE constraint failed: sale_cancellations.cancel_key")) {
    return Response.json({ error: "Ese producto de la venta ya fue anulado. Actualiza la pantalla para ver el inventario vigente." }, { status: 409 });
  }
  return Response.json({ error: message }, { status: 500 });
}

async function ensureCancellationSchema() {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sale_cancellations (
      cancel_key TEXT PRIMARY KEY,
      sale_folio TEXT NOT NULL DEFAULT '',
      movement_id INTEGER,
      canceled_by_user_id INTEGER,
      canceled_by TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const columns = await env.DB.prepare("PRAGMA table_info(sales)").all<{ name: string }>();
  const existing = new Set((columns.results ?? []).map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["voided", "INTEGER NOT NULL DEFAULT 0"],
    ["voided_by_user_id", "INTEGER"],
    ["voided_by", "TEXT NOT NULL DEFAULT ''"],
    ["voided_at", "TEXT"],
    ["void_reason", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await env.DB.prepare(`ALTER TABLE sales ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "movements.delete");
    await ensureOperationalSchema();
    await ensureSaleTrackingSchema();
    await ensureCancellationSchema();
    await ensureFieldOrderSchema();

    const body = await request.json() as Record<string, unknown>;
    const movementId = Number(body.movementId || 0);
    const reason = text(body.reason);
    if (!movementId || !reason) throw new AuthError("Selecciona un producto de la venta y captura el motivo de anulación.", 400);

    const target = await env.DB.prepare(`
      SELECT
        id,
        type,
        product_id AS productId,
        client_id AS clientId,
        reference,
        delta,
        voided,
        COALESCE(NULLIF(business_date, ''), SUBSTR(created_at, 1, 10)) AS businessDate
      FROM movements
      WHERE id = ?
      LIMIT 1
    `).bind(movementId).first<TargetMovement>();

    if (!target) throw new AuthError("Producto de la venta no encontrado.", 404);
    if (target.type !== "venta") throw new AuthError("Este registro no corresponde a un producto vendido.", 400);
    if (target.voided) throw new AuthError("Ese producto ya aparece anulado. Actualiza la pantalla para ver el inventario vigente.", 409);

    await assertBusinessDateOpen(target.businessDate);

    const folio = text(target.reference);
    const trackedSale = folio
      ? await env.DB.prepare("SELECT id, voided FROM sales WHERE folio = ? LIMIT 1")
          .bind(folio).first<{ id: number; voided: number }>()
      : null;
    const linkedFieldOrder = folio
      ? await env.DB.prepare(`
          SELECT id, folio, status FROM field_orders
          WHERE sale_reference = ? AND status IN ('transito', 'entregado')
          LIMIT 1
        `).bind(folio).first<LinkedFieldOrder>()
      : null;

    if (trackedSale?.voided) throw new AuthError("Esa venta ya fue anulada por completo.", 409);

    if (folio) {
      const activeCredit = await env.DB.prepare(`
        SELECT id FROM credit_notes
        WHERE active = 1 AND sale_reference = ? AND status <> 'Cancelada'
        LIMIT 1
      `).bind(folio).first<{ id: number }>();
      if (activeCredit) {
        throw new AuthError("La venta tiene una nota de crédito activa. Cancela o resuelve primero esa nota para mantener la trazabilidad financiera.", 409);
      }
    }

    // Una anulación se limita al producto seleccionado. Si el mismo producto aparece
    // más de una vez dentro del mismo folio, se consideran una sola partida comercial
    // del producto. Las devoluciones activas de ese mismo producto también se revierten
    // para que el inventario quede exactamente como antes de venderlo.
    let related: RelatedMovement[];
    if (folio && target.clientId) {
      const result = await env.DB.prepare(`
        SELECT
          m.id,
          m.type,
          m.product_id AS productId,
          p.sku,
          p.name AS productName,
          m.quantity,
          m.delta,
          m.total_amount AS totalAmount,
          p.current_stock AS currentStock
        FROM movements m
        INNER JOIN products p ON p.id = m.product_id
        WHERE m.voided = 0
          AND m.client_id = ?
          AND m.reference = ?
          AND m.product_id = ?
          AND m.type IN ('venta', 'devolucion_cliente')
        ORDER BY m.id
      `).bind(target.clientId, folio, target.productId).all<RelatedMovement>();
      related = result.results ?? [];
    } else {
      const single = await env.DB.prepare(`
        SELECT
          m.id,
          m.type,
          m.product_id AS productId,
          p.sku,
          p.name AS productName,
          m.quantity,
          m.delta,
          m.total_amount AS totalAmount,
          p.current_stock AS currentStock
        FROM movements m
        INNER JOIN products p ON p.id = m.product_id
        WHERE m.id = ? AND m.voided = 0
        LIMIT 1
      `).bind(movementId).first<RelatedMovement>();
      related = single ? [single] : [];
    }

    const saleMovements = related.filter((movement) => movement.type === "venta");
    if (!saleMovements.length) {
      throw new AuthError("No encontré una partida activa de ese producto para revertir.", 409);
    }

    const correctionByProduct = new Map<number, { correction: number; currentStock: number; sku: string; productName: string }>();
    for (const movement of related) {
      const current = correctionByProduct.get(movement.productId) ?? {
        correction: 0,
        currentStock: Number(movement.currentStock || 0),
        sku: movement.sku,
        productName: movement.productName,
      };
      current.correction += -Number(movement.delta || 0);
      correctionByProduct.set(movement.productId, current);
    }

    for (const product of correctionByProduct.values()) {
      if (product.currentStock + product.correction < 0) {
        throw new AuthError(`No se puede anular porque ${product.sku} · ${product.productName} quedaría con inventario negativo. Revisa devoluciones o movimientos posteriores.`, 409);
      }
    }

    const remainingSummary = folio && target.clientId
      ? await env.DB.prepare(`
          SELECT
            COUNT(*) AS lineCount,
            COALESCE(SUM(total_amount), 0) AS totalAmount
          FROM movements
          WHERE voided = 0
            AND type = 'venta'
            AND client_id = ?
            AND reference = ?
            AND product_id <> ?
        `).bind(target.clientId, folio, target.productId).first<RemainingSaleSummary>()
      : null;
    const remainingSaleLines = Number(remainingSummary?.lineCount || 0);
    const remainingTotalAmount = Number(remainingSummary?.totalAmount || 0);
    const fullyVoided = Boolean(trackedSale && remainingSaleLines === 0);

    const cancelKey = folio ? `sale:${folio}:product:${target.productId}` : `movement:${movementId}`;
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO sale_cancellations
          (cancel_key, sale_folio, movement_id, canceled_by_user_id, canceled_by, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(cancelKey, folio, movementId, user.id, user.displayName, reason),
    ];

    for (const [productId, product] of correctionByProduct) {
      if (product.correction !== 0) {
        statements.push(
          env.DB.prepare("UPDATE products SET current_stock = current_stock + ? WHERE id = ?")
            .bind(product.correction, productId),
        );
      }
    }

    for (const movement of related) {
      statements.push(env.DB.prepare(`
        UPDATE movements
        SET voided = 1, voided_by = ?, voided_at = CURRENT_TIMESTAMP, void_reason = ?
        WHERE id = ? AND voided = 0
      `).bind(user.displayName, reason, movement.id));
    }

    if (trackedSale) {
      if (fullyVoided) {
        statements.push(env.DB.prepare(`
          UPDATE sales
          SET total_amount = 0,
              voided = 1,
              voided_by_user_id = ?,
              voided_by = ?,
              voided_at = CURRENT_TIMESTAMP,
              void_reason = ?
          WHERE id = ? AND voided = 0
        `).bind(user.id, user.displayName, reason, trackedSale.id));
      } else {
        statements.push(env.DB.prepare(`
          UPDATE sales
          SET total_amount = ?,
              voided = 0,
              voided_by_user_id = NULL,
              voided_by = '',
              voided_at = NULL,
              void_reason = ''
          WHERE id = ?
        `).bind(remainingTotalAmount, trackedSale.id));
      }
    }

    if (linkedFieldOrder && fullyVoided) {
      statements.push(env.DB.prepare(`
        UPDATE field_orders
        SET status='cancelado', canceled_at=CURRENT_TIMESTAMP, canceled_reason=?,
            updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(`Venta anulada por completo: ${reason}`, user.id, user.displayName, linkedFieldOrder.id));
    }

    await env.DB.batch(statements);

    const restored: Array<{ productId: number; sku: string; productName: string; previousStock: number; newStock: number; correction: number }> = [];
    for (const [productId, product] of correctionByProduct) {
      const after = await env.DB.prepare("SELECT current_stock AS currentStock FROM products WHERE id = ? LIMIT 1")
        .bind(productId).first<{ currentStock: number }>();
      const newStock = Number(after?.currentStock ?? product.currentStock + product.correction);
      restored.push({ productId, sku: product.sku, productName: product.productName, previousStock: product.currentStock, newStock, correction: product.correction });
    }

    for (const movement of related) {
      await recordAudit({
        entityType: "movement",
        entityId: movement.id,
        action: movement.type === "venta" ? "anular_producto_venta" : "anular_devolucion_por_producto_venta",
        user,
        before: { type: movement.type, productId: movement.productId, quantity: movement.quantity, delta: movement.delta, folio },
        after: { voided: true },
        reason,
      });
    }

    if (trackedSale) {
      await recordAudit({
        entityType: "sale",
        entityId: trackedSale.id,
        action: fullyVoided ? "anular" : "anular_producto",
        user,
        before: { folio, voided: false },
        after: { folio, voided: fullyVoided, remainingSaleLines, remainingTotalAmount, restored },
        reason,
      });
    }

    if (linkedFieldOrder && fullyVoided) {
      await recordAudit({
        entityType: "field_order",
        entityId: linkedFieldOrder.id,
        action: "cancelar_por_anulacion_total_venta",
        user,
        before: { folio: linkedFieldOrder.folio, status: linkedFieldOrder.status, saleReference: folio },
        after: { folio: linkedFieldOrder.folio, status: "cancelado", restored },
        reason,
      });
    }

    const canceledProduct = saleMovements[0];
    const message = fullyVoided
      ? `${canceledProduct.sku} · ${canceledProduct.productName} fue anulado. Ya no quedan productos activos en ${folio || `#${movementId}`}, por lo que la venta quedó anulada por completo.`
      : `${canceledProduct.sku} · ${canceledProduct.productName} fue anulado de ${folio || `#${movementId}`}. El resto de la venta sigue vigente con ${remainingSaleLines} partida(s).`;

    return Response.json({
      ok: true,
      folio: folio || `#${movementId}`,
      canceledProduct: { productId: canceledProduct.productId, sku: canceledProduct.sku, productName: canceledProduct.productName },
      canceledMovements: related.length,
      restored,
      remainingSaleLines,
      remainingTotalAmount,
      fullyVoided,
      message,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
