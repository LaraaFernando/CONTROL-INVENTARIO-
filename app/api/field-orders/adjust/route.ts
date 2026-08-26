import { env } from "cloudflare:workers";
import { ensureOperationalSchema, recordAudit } from "../../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../../auth";
import { ensureFieldOrderSchema } from "../../../field-order-schema";

type OrderRow = {
  id: number;
  folio: string;
  status: string;
  totalAmount: number;
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
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo ajustar el pedido." }, { status: 500 });
}

async function getOrder(orderId: number) {
  return env.DB.prepare(`
    SELECT id, folio, status, total_amount AS totalAmount
    FROM field_orders
    WHERE id = ? LIMIT 1
  `).bind(orderId).first<OrderRow>();
}

async function getItems(orderId: number) {
  const result = await env.DB.prepare(`
    SELECT i.id, i.order_id AS orderId, i.product_id AS productId, i.quantity,
      i.unit_amount AS unitAmount, i.total_amount AS totalAmount,
      p.sku, p.name AS productName
    FROM field_order_items i
    INNER JOIN products p ON p.id = i.product_id
    WHERE i.order_id = ?
    ORDER BY i.id
  `).bind(orderId).all<ItemRow>();
  return (result.results ?? []).map((row) => ({
    ...row,
    id: Number(row.id),
    orderId: Number(row.orderId),
    productId: Number(row.productId),
    quantity: Number(row.quantity),
    unitAmount: Number(row.unitAmount || 0),
    totalAmount: Number(row.totalAmount || 0),
  }));
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
    const reason = text(body.reason);
    if (!orderId) throw new AuthError("Falta el pedido.", 400);
    if (!reason) throw new AuthError("Escribe el motivo del ajuste o cancelación.", 400);

    const order = await getOrder(orderId);
    if (!order) throw new AuthError("El pedido no existe.", 404);
    if (!["levantado", "preparando"].includes(order.status)) {
      throw new AuthError("Este pedido ya salió del almacén o fue cerrado. Para cambiarlo usa devolución o anulación de venta.", 409);
    }

    if (action === "cancel_order") {
      await env.DB.prepare(`
        UPDATE field_orders
        SET status='cancelado', canceled_at=CURRENT_TIMESTAMP, canceled_reason=?,
          updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('levantado', 'preparando')
      `).bind(reason, user.id, user.displayName, orderId).run();

      await recordAudit({
        entityType: "field_order",
        entityId: orderId,
        action: "cancelar",
        user,
        reason,
        before: { folio: order.folio, status: order.status, totalAmount: Number(order.totalAmount || 0) },
        after: { folio: order.folio, status: "cancelado", totalAmount: Number(order.totalAmount || 0) },
      });

      return Response.json({
        ok: true,
        folio: order.folio,
        status: "cancelado",
        message: `Pedido ${order.folio} cancelado completo. La mercancía apartada quedó liberada.`,
      });
    }

    if (action !== "cancel_item") throw new AuthError("Acción no válida.", 400);

    const itemId = Number(body.itemId || 0);
    const quantityToCancel = Number(body.quantity || 0);
    if (!itemId || !Number.isInteger(quantityToCancel) || quantityToCancel < 1) {
      throw new AuthError("Indica una cantidad válida para anular.", 400);
    }

    const items = await getItems(orderId);
    const item = items.find((row) => row.id === itemId);
    if (!item) throw new AuthError("El producto ya no forma parte de este pedido.", 404);
    if (quantityToCancel > item.quantity) {
      throw new AuthError(`Solo puedes anular hasta ${item.quantity} de ${item.sku} · ${item.productName}.`, 409);
    }

    if (items.length === 1 && quantityToCancel === item.quantity) {
      throw new AuthError("Es el último producto del pedido. Usa “Cancelar pedido completo” para conservar correctamente el historial.", 409);
    }

    const remainingQuantity = item.quantity - quantityToCancel;
    const lineTotalAfter = item.unitAmount * remainingQuantity;
    const statements: D1PreparedStatement[] = [];
    if (remainingQuantity === 0) {
      statements.push(
        env.DB.prepare("DELETE FROM field_order_items WHERE id=? AND order_id=? AND quantity=?")
          .bind(itemId, orderId, item.quantity),
      );
    } else {
      statements.push(
        env.DB.prepare(`
          UPDATE field_order_items
          SET quantity=?, total_amount=?
          WHERE id=? AND order_id=? AND quantity=?
        `).bind(remainingQuantity, lineTotalAfter, itemId, orderId, item.quantity),
      );
    }
    statements.push(
      env.DB.prepare(`
        UPDATE field_orders
        SET total_amount=(SELECT COALESCE(SUM(total_amount), 0) FROM field_order_items WHERE order_id=?),
          updated_by_user_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('levantado', 'preparando')
      `).bind(orderId, user.id, user.displayName, orderId),
    );

    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta.changes || 0) !== 1) {
      throw new AuthError("El pedido cambió mientras lo editabas. Actualiza e inténtalo de nuevo.", 409);
    }

    const updated = await getOrder(orderId);
    await recordAudit({
      entityType: "field_order",
      entityId: orderId,
      action: "anular_producto",
      user,
      reason,
      before: {
        folio: order.folio,
        status: order.status,
        totalAmount: Number(order.totalAmount || 0),
        item: { id: item.id, productId: item.productId, sku: item.sku, productName: item.productName, quantity: item.quantity, totalAmount: item.totalAmount },
      },
      after: {
        folio: order.folio,
        status: order.status,
        totalAmount: Number(updated?.totalAmount || 0),
        item: { id: item.id, productId: item.productId, sku: item.sku, productName: item.productName, quantity: remainingQuantity, canceledQuantity: quantityToCancel, totalAmount: lineTotalAfter },
      },
    });

    return Response.json({
      ok: true,
      folio: order.folio,
      status: order.status,
      itemId,
      canceledQuantity: quantityToCancel,
      remainingQuantity,
      totalAmount: Number(updated?.totalAmount || 0),
      message: remainingQuantity > 0
        ? `${item.sku} ajustado: se anularon ${quantityToCancel} y quedan ${remainingQuantity} en el pedido.`
        : `${item.sku} · ${item.productName} fue retirado del pedido.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
