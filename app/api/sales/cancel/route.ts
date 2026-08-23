import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, ensureOperationalSchema, recordAudit } from "../../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../../auth";
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
  currentStock: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "No se pudo anular la venta.";
  if (message.includes("UNIQUE constraint failed: sale_cancellations.cancel_key")) {
    return Response.json({ error: "Esa venta ya fue anulada. Actualiza la pantalla para ver el inventario vigente." }, { status: 409 });
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

    const body = await request.json() as Record<string, unknown>;
    const movementId = Number(body.movementId || 0);
    const reason = text(body.reason);
    if (!movementId || !reason) throw new AuthError("Selecciona una venta y captura el motivo de anulación.", 400);

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

    if (!target) throw new AuthError("Venta no encontrada.", 404);
    if (target.type !== "venta") throw new AuthError("Este registro no corresponde a una venta.", 400);
    if (target.voided) throw new AuthError("Esa venta ya aparece anulada. Actualiza la pantalla para ver el inventario vigente.", 409);

    await assertBusinessDateOpen(target.businessDate);

    const folio = text(target.reference);
    const trackedSale = folio
      ? await env.DB.prepare("SELECT id, voided FROM sales WHERE folio = ? LIMIT 1")
          .bind(folio).first<{ id: number; voided: number }>()
      : null;

    if (trackedSale?.voided) throw new AuthError("Esa venta ya fue anulada.", 409);

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
          p.current_stock AS currentStock
        FROM movements m
        INNER JOIN products p ON p.id = m.product_id
        WHERE m.voided = 0
          AND m.client_id = ?
          AND m.reference = ?
          AND m.type IN ('venta', 'devolucion_cliente')
        ORDER BY m.id
      `).bind(target.clientId, folio).all<RelatedMovement>();
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
          p.current_stock AS currentStock
        FROM movements m
        INNER JOIN products p ON p.id = m.product_id
        WHERE m.id = ? AND m.voided = 0
        LIMIT 1
      `).bind(movementId).first<RelatedMovement>();
      related = single ? [single] : [];
    }

    if (!related.some((movement) => movement.type === "venta")) {
      throw new AuthError("No encontré partidas activas de esa venta para revertir.", 409);
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

    const cancelKey = folio ? `sale:${folio}` : `movement:${movementId}`;
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
      statements.push(env.DB.prepare(`
        UPDATE sales
        SET voided = 1,
            voided_by_user_id = ?,
            voided_by = ?,
            voided_at = CURRENT_TIMESTAMP,
            void_reason = ?
        WHERE id = ? AND voided = 0
      `).bind(user.id, user.displayName, reason, trackedSale.id));
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
        action: movement.type === "venta" ? "anular_venta" : "anular_por_venta",
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
        action: "anular",
        user,
        before: { folio, voided: false },
        after: { folio, voided: true, restored },
        reason,
      });
    }

    return Response.json({
      ok: true,
      folio: folio || `#${movementId}`,
      canceledMovements: related.length,
      restored,
      message: `Venta ${folio || `#${movementId}`} anulada. El inventario fue restaurado y las partidas relacionadas quedaron anuladas.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
