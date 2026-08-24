import { env } from "cloudflare:workers";
import { businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { ensureFieldOrderSchema } from "../../field-order-schema";
import { ensureSaleTrackingSchema, nextSaleFolio } from "../../sale-tracking";

type OrderStatus = "levantado" | "preparando" | "transito" | "entregado" | "cancelado";
type OrderRow = {
  id: number;
  folio: string;
  clientId: number;
  clientName: string;
  status: OrderStatus;
  totalAmount: number;
  notes: string;
  createdBy: string;
  businessDate: string;
  createdAt: string;
  saleReference: string;
  preparingAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  canceledReason: string;
  updatedBy: string;
};
type ItemRow = {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  sku: string;
  productName: string;
  unit: string;
  currentStock: number;
};

function text(value: unknown) { return String(value ?? "").trim(); }

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "No se pudo actualizar el pedido.";
  if (message.toLowerCase().includes("inventario no puede quedar negativo")) {
    return Response.json({ error: "La existencia física cambió. Revisa el pedido antes de despacharlo." }, { status: 409 });
  }
  return Response.json({ error: message }, { status: 500 });
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

async function getOrder(orderId: number) {
  return env.DB.prepare(`
    SELECT o.id, o.folio, o.client_id AS clientId, c.name AS clientName, o.status,
      o.total_amount AS totalAmount, o.notes, o.created_by AS createdBy,
      o.business_date AS businessDate, o.created_at AS createdAt,
      o.sale_reference AS saleReference, o.preparing_at AS preparingAt,
      o.dispatched_at AS dispatchedAt, o.delivered_at AS deliveredAt,
      o.canceled_at AS canceledAt, o.canceled_reason AS canceledReason,
      o.updated_by AS updatedBy
    FROM field_orders o
    INNER JOIN clients c ON c.id = o.client_id
    WHERE o.id = ? LIMIT 1
  `).bind(orderId).first<OrderRow>();
}

async function getItems(orderId: number) {
  const result = await env.DB.prepare(`
    SELECT i.id, i.order_id AS orderId, i.product_id AS productId, i.quantity,
      i.unit_amount AS unitAmount, i.total_amount AS totalAmount,
      p.sku, p.name AS productName, p.unit, p.current_stock AS currentStock
    FROM field_order_items i
    INNER JOIN products p ON p.id = i.product_id
    WHERE i.order_id = ? ORDER BY i.id
  `).bind(orderId).all<ItemRow>();
  return (result.results ?? []).map((row) => ({
    ...row,
    orderId: Number(row.orderId), productId: Number(row.productId), quantity: Number(row.quantity),
    unitAmount: Number(row.unitAmount || 0), totalAmount: Number(row.totalAmount || 0), currentStock: Number(row.currentStock || 0),
  }));
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    await ensureFieldOrderSchema();

    const ordersResult = await env.DB.prepare(`
      SELECT o.id, o.folio, o.client_id AS clientId, c.name AS clientName, o.status,
        o.total_amount AS totalAmount, o.notes, o.created_by AS createdBy,
        o.business_date AS businessDate, o.created_at AS createdAt,
        o.sale_reference AS saleReference, o.preparing_at AS preparingAt,
        o.dispatched_at AS dispatchedAt, o.delivered_at AS deliveredAt,
        o.canceled_at AS canceledAt, o.canceled_reason AS canceledReason,
        o.updated_by AS updatedBy
      FROM field_orders o
      INNER JOIN clients c ON c.id = o.client_id
      ORDER BY CASE o.status
        WHEN 'levantado' THEN 0 WHEN 'preparando' THEN 1 WHEN 'transito' THEN 2
        WHEN 'entregado' THEN 3 ELSE 4 END, o.id DESC
      LIMIT 100
    `).all<OrderRow>();
    const itemsResult = await env.DB.prepare(`
      SELECT i.id, i.order_id AS orderId, i.product_id AS productId, i.quantity,
        i.unit_amount AS unitAmount, i.total_amount AS totalAmount,
        p.sku, p.name AS productName, p.unit, p.current_stock AS currentStock
      FROM field_order_items i
      INNER JOIN products p ON p.id = i.product_id
      WHERE i.order_id IN (SELECT id FROM field_orders ORDER BY id DESC LIMIT 100)
      ORDER BY i.order_id DESC, i.id
    `).all<ItemRow>();
    const items = itemsResult.results ?? [];
    const orders = (ordersResult.results ?? []).map((row) => ({
      ...row,
      id: Number(row.id), clientId: Number(row.clientId), totalAmount: Number(row.totalAmount || 0),
      items: items.filter((item) => Number(item.orderId) === Number(row.id)).map((item) => ({
        ...item,
        productId: Number(item.productId), quantity: Number(item.quantity), unitAmount: Number(item.unitAmount || 0),
        totalAmount: Number(item.totalAmount || 0), currentStock: Number(item.currentStock || 0),
      })),
    }));

    return Response.json({
      orders,
      canManageWarehouse: Boolean(user.permissions["orders.manage"]),
      summary: {
        newOrders: orders.filter((order) => order.status === "levantado").length,
        preparing: orders.filter((order) => order.status === "preparando").length,
        inTransit: orders.filter((order) => order.status === "transito").length,
        delivered: orders.filter((order) => order.status === "entregado").length,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "orders.manage");
    await ensureOperationalSchema();
    await ensureFieldOrderSchema();

    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action);
    const orderId = Number(body.orderId || 0);
    if (!orderId) throw new AuthError("Falta el pedido.", 400);
    const order = await getOrder(orderId);
    if (!order) throw new AuthError("El pedido no existe.", 404);

    if (action === "start_preparing") {
      if (order.status !== "levantado") throw new AuthError("Solo un pedido nuevo puede pasar a preparación.", 409);
      await env.DB.prepare(`
        UPDATE field_orders SET status='preparando', preparing_at=CURRENT_TIMESTAMP,
          updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(user.id, user.displayName, orderId).run();
      await recordAudit({ entityType: "field_order", entityId: orderId, action: "preparar", user, before: { status: order.status }, after: { folio: order.folio, status: "preparando" } });
      return Response.json({ ok: true, folio: order.folio, status: "preparando" });
    }

    if (action === "cancel") {
      if (!["levantado", "preparando"].includes(order.status)) throw new AuthError("Un pedido que ya salió del almacén no puede cancelarse desde aquí.", 409);
      const reason = text(body.reason);
      if (!reason) throw new AuthError("Escribe el motivo de cancelación.", 400);
      await env.DB.prepare(`
        UPDATE field_orders SET status='cancelado', canceled_at=CURRENT_TIMESTAMP, canceled_reason=?,
          updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(reason, user.id, user.displayName, orderId).run();
      await recordAudit({ entityType: "field_order", entityId: orderId, action: "cancelar", user, reason, before: { status: order.status }, after: { folio: order.folio, status: "cancelado" } });
      return Response.json({ ok: true, folio: order.folio, status: "cancelado" });
    }

    if (action === "dispatch") {
      if (order.status !== "preparando") throw new AuthError("Primero marca el pedido como Preparando.", 409);
      const items = await getItems(orderId);
      if (!items.length) throw new AuthError("El pedido no tiene productos.", 409);
      const shortage = items.find((item) => item.currentStock < item.quantity);
      if (shortage) throw new AuthError(`${shortage.sku} · ${shortage.productName}: el físico ya no alcanza para despachar ${shortage.quantity}.`, 409);

      await ensureSaleTrackingSchema();
      await ensureDeliverySchema();
      const saleDate = businessDate();
      const saleReference = await nextSaleFolio(saleDate);
      const movementNotes = `Pedido ${order.folio}${order.notes ? ` · ${order.notes}` : ""}`;
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(`
          INSERT INTO sales
            (folio, client_id, total_amount, external_reference, notes, created_by_user_id, created_by, business_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(saleReference, order.clientId, order.totalAmount, order.folio, order.notes, user.id, user.displayName, saleDate),
      ];
      for (const item of items) {
        statements.push(env.DB.prepare(`
          INSERT INTO movements
            (product_id, client_id, type, quantity, delta, reference, notes, performed_by,
             unit_amount, total_amount, requested_quantity, pending_quantity, presentation,
             presentation_factor, performed_by_user_id, business_date, source_type, source_id)
          VALUES (?, ?, 'venta', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?, 'field_order', ?)
        `).bind(item.productId, order.clientId, item.quantity, -item.quantity, saleReference, movementNotes,
          user.displayName, item.unitAmount, item.totalAmount, item.quantity, item.unit || "pieza", user.id, saleDate, orderId));
        statements.push(env.DB.prepare("UPDATE products SET current_stock=current_stock-? WHERE id=?").bind(item.quantity, item.productId));
      }
      statements.push(env.DB.prepare(`
        UPDATE field_orders SET status='transito', sale_reference=?, dispatched_at=CURRENT_TIMESTAMP,
          updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(saleReference, user.id, user.displayName, orderId));
      statements.push(env.DB.prepare(`
        INSERT INTO sale_delivery_status
          (sale_reference, status, in_transit_at, updated_by_user_id, updated_by, updated_at)
        VALUES (?, 'transito', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(sale_reference) DO UPDATE SET
          status='transito', in_transit_at=COALESCE(sale_delivery_status.in_transit_at, CURRENT_TIMESTAMP),
          updated_by_user_id=excluded.updated_by_user_id, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
      `).bind(saleReference, user.id, user.displayName));

      const results = await env.DB.batch(statements);
      const saleId = Number(results[0]?.meta.last_row_id || 0);
      if (saleId) await recordAudit({ entityType: "sale", entityId: saleId, action: "crear_desde_pedido", user, after: { folio: saleReference, orderFolio: order.folio, clientId: order.clientId, totalAmount: order.totalAmount } });
      for (let index = 0; index < items.length; index += 1) {
        const movementId = Number(results[1 + index * 2]?.meta.last_row_id || 0);
        const item = items[index];
        if (movementId) await recordAudit({ entityType: "movement", entityId: movementId, action: "despachar_pedido", user, after: { orderFolio: order.folio, saleReference, productId: item.productId, sku: item.sku, quantity: item.quantity, previousStock: item.currentStock, newStock: item.currentStock - item.quantity } });
      }
      await recordAudit({ entityType: "field_order", entityId: orderId, action: "despachar", user, before: { status: order.status }, after: { folio: order.folio, status: "transito", saleReference } });
      return Response.json({ ok: true, folio: order.folio, status: "transito", saleReference });
    }

    if (action === "deliver") {
      if (order.status !== "transito") throw new AuthError("Solo un pedido en tránsito puede marcarse como entregado.", 409);
      if (body.completeConfirmed !== true) throw new AuthError("Confirma que el cliente recibió completa la mercancía.", 400);
      await ensureDeliverySchema();
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE field_orders SET status='entregado', delivered_at=CURRENT_TIMESTAMP,
            updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(user.id, user.displayName, orderId),
        env.DB.prepare(`
          INSERT INTO sale_delivery_status
            (sale_reference, status, in_transit_at, delivered_at, updated_by_user_id, updated_by, updated_at)
          VALUES (?, 'entregada', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(sale_reference) DO UPDATE SET
            status='entregada', delivered_at=CURRENT_TIMESTAMP,
            updated_by_user_id=excluded.updated_by_user_id, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
        `).bind(order.saleReference, user.id, user.displayName),
      ]);
      await recordAudit({ entityType: "field_order", entityId: orderId, action: "entregar", user, before: { status: order.status }, after: { folio: order.folio, status: "entregado", completeConfirmed: true, saleReference: order.saleReference } });
      return Response.json({ ok: true, folio: order.folio, status: "entregado" });
    }

    throw new AuthError("Acción no válida.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
