import { env } from "cloudflare:workers";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { addDays, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";

type JsonBody = Record<string, unknown>;
type OrderItemInput = { productId?: unknown; quantity?: unknown; presentation?: unknown; unitCost?: unknown };
type ReceiptItemInput = { itemId?: unknown; quantity?: unknown };

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const text = error instanceof Error ? error.message : "Error inesperado";
  if (text.includes("UNIQUE constraint failed")) return Response.json({ error: "El folio ya está registrado." }, { status: 409 });
  return Response.json({ error: text }, { status: 500 });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown, fallback = 0) {
  const number = Math.floor(Number(value ?? fallback));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveAmount(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function paymentMethod(value: unknown) {
  return text(value).toUpperCase() === "PPD" ? "PPD" : "PUE";
}

function factorFor(product: { set_factor: number; box_factor: number }, presentation: string) {
  if (presentation === "ciento") return 100;
  if (presentation === "juego") return Math.max(1, Number(product.set_factor || 1));
  if (presentation === "caja") return Math.max(1, Number(product.box_factor || 1));
  return 1;
}

async function closureSummary(date: string) {
  const movementResult = await env.DB.prepare(`
    SELECT type, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
    FROM movements
    WHERE voided = 0
      AND COALESCE(NULLIF(business_date, ''), substr(created_at, 1, 10)) = ?
    GROUP BY type
  `).bind(date).all<{ type: string; count: number; amount: number }>();
  const paymentResult = await env.DB.prepare(`
    SELECT i.direction, COALESCE(SUM(p.amount), 0) AS amount
    FROM invoice_payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    WHERE p.voided = 0 AND i.canceled = 0 AND substr(p.paid_at, 1, 10) = ?
    GROUP BY i.direction
  `).bind(date).all<{ direction: string; amount: number }>();
  const inventoryResult = await env.DB.prepare(`
    SELECT id, sku, name, current_stock AS currentStock, cost,
      current_stock * cost AS inventoryValue
    FROM products WHERE active = 1 ORDER BY name
  `).all<{ id: number; sku: string; name: string; currentStock: number; cost: number; inventoryValue: number }>();

  const movements = movementResult.results ?? [];
  const payments = paymentResult.results ?? [];
  const movementCount = movements.reduce((sum, row) => sum + Number(row.count), 0);
  const sales = Number(movements.find((row) => row.type === "venta")?.amount ?? 0);
  const purchases = Number(movements.find((row) => row.type === "entrada_compra")?.amount ?? 0);
  const receivedPayments = Number(payments.find((row) => row.direction === "cliente")?.amount ?? 0);
  const sentPayments = Number(payments.find((row) => row.direction === "proveedor")?.amount ?? 0);
  const inventory = inventoryResult.results ?? [];
  const inventoryValue = inventory.reduce((sum, row) => sum + Number(row.inventoryValue || 0), 0);
  return {
    businessDate: date,
    movementCount,
    sales,
    purchases,
    receivedPayments,
    sentPayments,
    moneyIn: sales,
    moneyOut: purchases,
    inventoryValue,
    movementBreakdown: movements,
    inventory,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const url = new URL(request.url);
    const entityType = text(url.searchParams.get("entityType"));
    const entityId = Number(url.searchParams.get("entityId") || 0);

    if (entityType && entityId) {
      requirePermission(user, "audit.view");
      const rows = await env.DB.prepare(`
        SELECT id, entity_type AS entityType, entity_id AS entityId, action,
          user_id AS userId, username, display_name AS displayName,
          before_json AS beforeJson, after_json AS afterJson, reason, created_at AS createdAt
        FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC
      `).bind(entityType, entityId).all();
      return Response.json({ audit: rows.results ?? [] });
    }

    const [supplierResult, orderResult, itemResult, invoiceResult, paymentResult, fileResult, closureResult] = await Promise.all([
      env.DB.prepare(`SELECT id, name, business_name AS businessName, tax_id AS taxId, phone, email,
        invoice_required AS invoiceRequired, default_payment_method AS defaultPaymentMethod,
        credit_days AS creditDays, active, created_at AS createdAt
        FROM suppliers WHERE active = 1 ORDER BY name`).all(),
      env.DB.prepare(`SELECT o.id, o.folio, o.supplier_id AS supplierId, s.name AS supplierName,
        o.status, o.received_status AS receivedStatus, o.tracking_number AS trackingNumber,
        o.expected_at AS expectedAt, o.payment_method AS paymentMethod,
        o.invoice_required AS invoiceRequired, o.credit_days AS creditDays, o.due_date AS dueDate,
        o.total_amount AS totalAmount, o.notes, o.created_by AS createdBy, o.canceled,
        o.canceled_by AS canceledBy, o.canceled_at AS canceledAt, o.created_at AS createdAt
        FROM purchase_orders o INNER JOIN suppliers s ON s.id = o.supplier_id ORDER BY o.id DESC LIMIT 200`).all(),
      env.DB.prepare(`SELECT i.id, i.order_id AS orderId, i.product_id AS productId,
        p.sku, p.name AS productName, i.presentation, i.presentation_factor AS presentationFactor,
        i.ordered_quantity AS orderedQuantity, i.received_quantity AS receivedQuantity,
        i.unit_cost AS unitCost, i.total_amount AS totalAmount
        FROM purchase_order_items i INNER JOIN products p ON p.id = i.product_id ORDER BY i.id`).all(),
      env.DB.prepare(`SELECT i.id, i.direction, i.folio, i.uuid, i.client_id AS clientId,
        i.supplier_id AS supplierId, i.purchase_order_id AS purchaseOrderId,
        COALESCE(c.name, s.name, '') AS counterparty, i.payment_method AS paymentMethod,
        i.credit_days AS creditDays, i.issue_date AS issueDate, i.due_date AS dueDate,
        i.subtotal, i.tax_amount AS taxAmount, i.total_amount AS totalAmount,
        i.paid_amount AS paidAmount, i.status, i.notes, i.created_by AS createdBy,
        i.canceled, i.canceled_by AS canceledBy, i.canceled_at AS canceledAt,
        i.created_at AS createdAt
        FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        LEFT JOIN suppliers s ON s.id = i.supplier_id ORDER BY i.id DESC LIMIT 300`).all(),
      env.DB.prepare(`SELECT id, invoice_id AS invoiceId, amount, reference, paid_at AS paidAt,
        created_by AS createdBy, voided, voided_by AS voidedBy, voided_at AS voidedAt,
        created_at AS createdAt FROM invoice_payments ORDER BY id DESC LIMIT 500`).all(),
      env.DB.prepare(`SELECT id, invoice_id AS invoiceId, kind, file_name AS fileName,
        content_type AS contentType, size, uploaded_by AS uploadedBy, created_at AS createdAt
        FROM invoice_files ORDER BY id DESC LIMIT 500`).all(),
      env.DB.prepare(`SELECT id, business_date AS businessDate, movement_count AS movementCount,
        money_in AS moneyIn, money_out AS moneyOut, inventory_value AS inventoryValue,
        summary_json AS summaryJson, closed_by AS closedBy, created_at AS createdAt
        FROM daily_closures ORDER BY business_date DESC LIMIT 100`).all(),
    ]);

    const audit = user.permissions["audit.view"]
      ? (await env.DB.prepare(`SELECT id, entity_type AS entityType, entity_id AS entityId,
          action, user_id AS userId, username, display_name AS displayName,
          before_json AS beforeJson, after_json AS afterJson, reason, created_at AS createdAt
          FROM audit_events ORDER BY id DESC LIMIT 300`).all()).results ?? []
      : [];

    return Response.json({
      suppliers: supplierResult.results ?? [],
      orders: orderResult.results ?? [],
      orderItems: itemResult.results ?? [],
      invoices: invoiceResult.results ?? [],
      payments: paymentResult.results ?? [],
      files: fileResult.results ?? [],
      closures: closureResult.results ?? [],
      audit,
      closurePreview: user.permissions["closures.manage"] ? await closureSummary(businessDate()) : null,
      today: businessDate(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const body = await request.json() as JsonBody;
    const action = text(body.action);

    if (action === "add_supplier" || action === "edit_supplier") {
      requirePermission(user, "suppliers.manage");
      const id = Number(body.id || 0);
      const name = text(body.name);
      if (!name) throw new AuthError("El nombre del proveedor es obligatorio.", 400);
      const values = {
        name,
        businessName: text(body.businessName),
        taxId: text(body.taxId).toUpperCase(),
        phone: text(body.phone),
        email: text(body.email),
        invoiceRequired: bool(body.invoiceRequired) ? 1 : 0,
        method: paymentMethod(body.defaultPaymentMethod),
        days: Math.max(0, positiveInteger(body.creditDays)),
      };
      if (action === "add_supplier") {
        const result = await env.DB.prepare(`INSERT INTO suppliers
          (name, business_name, tax_id, phone, email, invoice_required, default_payment_method, credit_days)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(values.name, values.businessName, values.taxId, values.phone, values.email,
            values.invoiceRequired, values.method, values.method === "PUE" ? 0 : values.days).run();
        const supplierId = Number(result.meta.last_row_id);
        await recordAudit({ entityType: "supplier", entityId: supplierId, action: "crear", user, after: values });
        return Response.json({ ok: true, id: supplierId }, { status: 201 });
      }
      if (!id) throw new AuthError("Proveedor inválido.", 400);
      const before = await env.DB.prepare("SELECT * FROM suppliers WHERE id=? LIMIT 1").bind(id).first();
      if (!before) throw new AuthError("Proveedor no encontrado.", 404);
      await env.DB.prepare(`UPDATE suppliers SET name=?, business_name=?, tax_id=?, phone=?, email=?,
        invoice_required=?, default_payment_method=?, credit_days=? WHERE id=? AND active=1`)
        .bind(values.name, values.businessName, values.taxId, values.phone, values.email,
          values.invoiceRequired, values.method, values.method === "PUE" ? 0 : values.days, id).run();
      await recordAudit({ entityType: "supplier", entityId: id, action: "modificar", user, before, after: values });
      return Response.json({ ok: true });
    }

    if (action === "create_order") {
      requirePermission(user, "orders.manage");
      const folio = text(body.folio).toUpperCase();
      const supplierId = Number(body.supplierId || 0);
      const items = Array.isArray(body.items) ? body.items as OrderItemInput[] : [];
      if (!folio || !supplierId || !items.length) throw new AuthError("Folio, proveedor y productos son obligatorios.", 400);
      const supplier = await env.DB.prepare("SELECT * FROM suppliers WHERE id=? AND active=1 LIMIT 1").bind(supplierId).first<{
        default_payment_method: string; invoice_required: number; credit_days: number;
      }>();
      if (!supplier) throw new AuthError("Proveedor no encontrado.", 404);
      const method = paymentMethod(body.paymentMethod || supplier.default_payment_method);
      const creditDays = method === "PUE" ? 0 : Math.max(1, positiveInteger(body.creditDays, supplier.credit_days || 30));
      const createdDate = businessDate();
      const dueDate = addDays(createdDate, creditDays);
      const normalized: Array<{ productId: number; presentation: string; factor: number; quantity: number; unitCost: number; total: number }> = [];
      const productIds = new Set<number>();
      for (const item of items) {
        const productId = Number(item.productId || 0);
        const product = await env.DB.prepare("SELECT id, cost, set_factor, box_factor FROM products WHERE id=? AND active=1 LIMIT 1")
          .bind(productId).first<{ id: number; cost: number; set_factor: number; box_factor: number }>();
        const count = positiveInteger(item.quantity);
        if (!product || !count) throw new AuthError("Hay un producto o cantidad inválida en el pedido.", 400);
        if (productIds.has(productId)) throw new AuthError("Cada producto debe aparecer una sola vez por pedido.", 400);
        productIds.add(productId);
        const presentation = ["pieza", "unidad", "ciento", "juego", "caja"].includes(text(item.presentation)) ? text(item.presentation) : "pieza";
        const factor = factorFor(product, presentation);
        const quantity = count * factor;
        const unitCost = positiveAmount(item.unitCost, Number(product.cost || 0));
        normalized.push({ productId, presentation, factor, quantity, unitCost, total: quantity * unitCost });
      }
      const total = normalized.reduce((sum, item) => sum + item.total, 0);
      const result = await env.DB.prepare(`INSERT INTO purchase_orders
        (folio, supplier_id, status, tracking_number, expected_at, payment_method, invoice_required,
          credit_days, due_date, total_amount, notes, created_by_user_id, created_by)
        VALUES (?, ?, 'pedido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(folio, supplierId, text(body.trackingNumber), text(body.expectedAt) || null, method,
          bool(body.invoiceRequired ?? supplier.invoice_required) ? 1 : 0, creditDays, dueDate, total,
          text(body.notes), user.id, user.displayName).run();
      const orderId = Number(result.meta.last_row_id);
      await env.DB.batch(normalized.map((item) => env.DB.prepare(`INSERT INTO purchase_order_items
        (order_id, product_id, presentation, presentation_factor, ordered_quantity, unit_cost, total_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(orderId, item.productId, item.presentation, item.factor, item.quantity, item.unitCost, item.total)));
      await recordAudit({ entityType: "purchase_order", entityId: orderId, action: "crear", user,
        after: { folio, supplierId, method, creditDays, dueDate, total, items: normalized } });
      return Response.json({ ok: true, id: orderId }, { status: 201 });
    }

    if (action === "update_order_status") {
      requirePermission(user, "orders.manage");
      const id = Number(body.id || 0);
      const status = text(body.status);
      if (!id || !["pedido", "transito", "entregado"].includes(status)) throw new AuthError("Estatus de pedido inválido.", 400);
      const before = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id=? LIMIT 1").bind(id).first<{ canceled: number }>();
      if (!before || before.canceled) throw new AuthError("Pedido no encontrado o cancelado.", 404);
      await env.DB.prepare("UPDATE purchase_orders SET status=?, tracking_number=?, expected_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(status, text(body.trackingNumber), text(body.expectedAt) || null, id).run();
      await recordAudit({ entityType: "purchase_order", entityId: id, action: "estatus", user, before,
        after: { status, trackingNumber: text(body.trackingNumber), expectedAt: text(body.expectedAt) } });
      return Response.json({ ok: true });
    }

    if (action === "cancel_order") {
      requirePermission(user, "orders.manage");
      const id = Number(body.id || 0);
      const reason = text(body.reason);
      if (!id || !reason) throw new AuthError("Indica el motivo de la anulación.", 400);
      const before = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id=? LIMIT 1").bind(id).first<{ canceled: number }>();
      if (!before) throw new AuthError("Pedido no encontrado.", 404);
      if (before.canceled) throw new AuthError("El pedido ya está anulado.", 409);
      const received = await env.DB.prepare("SELECT COALESCE(SUM(received_quantity),0) AS total FROM purchase_order_items WHERE order_id=?")
        .bind(id).first<{ total: number }>();
      if (Number(received?.total || 0) > 0) throw new AuthError("No se puede anular un pedido con recepciones. Anula los movimientos relacionados mediante auditoría.", 409);
      await env.DB.prepare("UPDATE purchase_orders SET canceled=1, canceled_by=?, canceled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(user.displayName, id).run();
      await recordAudit({ entityType: "purchase_order", entityId: id, action: "anular", user, before, after: { canceled: true }, reason });
      return Response.json({ ok: true });
    }

    if (action === "receive_order") {
      requirePermission(user, "orders.manage");
      const orderId = Number(body.orderId || 0);
      const entries = Array.isArray(body.items) ? body.items as ReceiptItemInput[] : [];
      const order = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id=? LIMIT 1").bind(orderId).first<{ id: number; folio: string; canceled: number }>();
      if (!order || order.canceled) throw new AuthError("Pedido no encontrado o cancelado.", 404);
      const accepted: Array<{ itemId: number; productId: number; quantity: number; unitCost: number; newStock: number }> = [];
      for (const entry of entries) {
        const itemId = Number(entry.itemId || 0);
        const quantity = positiveInteger(entry.quantity);
        if (!quantity) continue;
        const item = await env.DB.prepare(`SELECT i.id, i.product_id, i.ordered_quantity, i.received_quantity,
          i.unit_cost, p.current_stock FROM purchase_order_items i INNER JOIN products p ON p.id=i.product_id
          WHERE i.id=? AND i.order_id=? LIMIT 1`).bind(itemId, orderId).first<{
            id: number; product_id: number; ordered_quantity: number; received_quantity: number; unit_cost: number; current_stock: number;
          }>();
        if (!item) throw new AuthError("Partida de pedido inválida.", 400);
        const remaining = Number(item.ordered_quantity) - Number(item.received_quantity);
        if (quantity > remaining) throw new AuthError(`La recepción excede lo pendiente en la partida ${itemId}.`, 400);
        accepted.push({ itemId, productId: item.product_id, quantity, unitCost: Number(item.unit_cost), newStock: Number(item.current_stock) + quantity });
      }
      if (!accepted.length) throw new AuthError("Captura al menos una cantidad recibida.", 400);
      const receipt = await env.DB.prepare(`INSERT INTO purchase_receipts
        (order_id, received_by_user_id, received_by, notes) VALUES (?, ?, ?, ?)`)
        .bind(orderId, user.id, user.displayName, text(body.notes)).run();
      const receiptId = Number(receipt.meta.last_row_id);
      const date = businessDate();
      const statements = accepted.flatMap((entry) => [
        env.DB.prepare("INSERT INTO purchase_receipt_items (receipt_id, order_item_id, product_id, quantity) VALUES (?, ?, ?, ?)")
          .bind(receiptId, entry.itemId, entry.productId, entry.quantity),
        env.DB.prepare("UPDATE purchase_order_items SET received_quantity=received_quantity+? WHERE id=?")
          .bind(entry.quantity, entry.itemId),
        env.DB.prepare("UPDATE products SET current_stock=? WHERE id=?").bind(entry.newStock, entry.productId),
        env.DB.prepare(`INSERT INTO movements
          (product_id, type, quantity, delta, reference, notes, performed_by, unit_amount, total_amount,
            requested_quantity, pending_quantity, presentation, presentation_factor, performed_by_user_id, business_date)
          VALUES (?, 'entrada_compra', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pieza', 1, ?, ?)`)
          .bind(entry.productId, entry.quantity, entry.quantity, order.folio, `Recepción ${receiptId}`,
            user.displayName, entry.unitCost, entry.unitCost * entry.quantity, entry.quantity, user.id, date),
      ]);
      await env.DB.batch(statements);
      const remaining = await env.DB.prepare(`SELECT COUNT(*) AS total FROM purchase_order_items
        WHERE order_id=? AND received_quantity < ordered_quantity`).bind(orderId).first<{ total: number }>();
      const receivedStatus = Number(remaining?.total || 0) === 0 ? "completo" : "incompleto";
      await env.DB.prepare(`UPDATE purchase_orders SET received_status=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(receivedStatus, receivedStatus === "completo" ? "entregado" : "transito", orderId).run();
      await recordAudit({ entityType: "purchase_order", entityId: orderId, action: "recepcion", user,
        after: { receiptId, receivedStatus, items: accepted }, reason: text(body.notes) });
      return Response.json({ ok: true, receiptId, receivedStatus }, { status: 201 });
    }

    if (action === "create_invoice") {
      requirePermission(user, "invoices.manage");
      const direction = text(body.direction);
      const folio = text(body.folio).toUpperCase();
      const clientId = Number(body.clientId || 0) || null;
      const supplierId = Number(body.supplierId || 0) || null;
      if (!["cliente", "proveedor"].includes(direction) || !folio || (direction === "cliente" ? !clientId : !supplierId)) {
        throw new AuthError("Dirección, folio y cliente/proveedor son obligatorios.", 400);
      }
      const method = paymentMethod(body.paymentMethod);
      const issueDate = text(body.issueDate) || businessDate();
      const creditDays = method === "PUE" ? 0 : Math.max(1, positiveInteger(body.creditDays, 30));
      const dueDate = addDays(issueDate, creditDays);
      const subtotal = Math.max(0, Number(body.subtotal || 0));
      const taxAmount = Math.max(0, Number(body.taxAmount || 0));
      const total = positiveAmount(body.totalAmount, subtotal + taxAmount);
      if (!total) throw new AuthError("El total de la factura debe ser mayor a cero.", 400);
      const result = await env.DB.prepare(`INSERT INTO invoices
        (direction, folio, uuid, client_id, supplier_id, purchase_order_id, payment_method,
          credit_days, issue_date, due_date, subtotal, tax_amount, total_amount, notes,
          created_by_user_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(direction, folio, text(body.uuid).toUpperCase(), clientId, supplierId,
          Number(body.purchaseOrderId || 0) || null, method, creditDays, issueDate, dueDate,
          subtotal, taxAmount, total, text(body.notes), user.id, user.displayName).run();
      const invoiceId = Number(result.meta.last_row_id);
      await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "crear", user,
        after: { direction, folio, method, creditDays, issueDate, dueDate, total } });
      return Response.json({ ok: true, id: invoiceId }, { status: 201 });
    }

    if (action === "add_payment") {
      requirePermission(user, "invoices.manage");
      const invoiceId = Number(body.invoiceId || 0);
      const amount = positiveAmount(body.amount);
      const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id=? LIMIT 1").bind(invoiceId).first<{
        total_amount: number; paid_amount: number; canceled: number;
      }>();
      if (!invoice || invoice.canceled) throw new AuthError("Factura no encontrada o cancelada.", 404);
      const balance = Number(invoice.total_amount) - Number(invoice.paid_amount);
      if (!amount || amount > balance + 0.005) throw new AuthError(`El pago excede el saldo de ${balance.toFixed(2)}.`, 400);
      const result = await env.DB.prepare(`INSERT INTO invoice_payments
        (invoice_id, amount, reference, paid_at, created_by_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(invoiceId, amount, text(body.reference), text(body.paidAt) || businessDate(), user.id, user.displayName).run();
      const newPaid = Number(invoice.paid_amount) + amount;
      const status = newPaid + 0.005 >= Number(invoice.total_amount) ? "pagada" : "parcial";
      await env.DB.prepare("UPDATE invoices SET paid_amount=?, status=? WHERE id=?").bind(newPaid, status, invoiceId).run();
      await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "pago", user,
        before: { paidAmount: invoice.paid_amount }, after: { paymentId: result.meta.last_row_id, amount, paidAmount: newPaid, status } });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "cancel_invoice") {
      requirePermission(user, "invoices.manage");
      const invoiceId = Number(body.invoiceId || 0);
      const reason = text(body.reason);
      if (!invoiceId || !reason) throw new AuthError("Indica el motivo de la cancelación.", 400);
      const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id=? LIMIT 1").bind(invoiceId).first<{ canceled: number }>();
      if (!invoice) throw new AuthError("Factura no encontrada.", 404);
      if (invoice.canceled) throw new AuthError("La factura ya está cancelada.", 409);
      await env.DB.prepare("UPDATE invoices SET canceled=1, status='cancelada', canceled_by=?, canceled_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(user.displayName, invoiceId).run();
      await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "cancelar", user,
        before: invoice, after: { canceled: true, status: "cancelada" }, reason });
      return Response.json({ ok: true });
    }

    if (action === "confirm_close") {
      requirePermission(user, "closures.manage");
      const date = text(body.businessDate) || businessDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AuthError("Fecha de corte inválida.", 400);
      const existing = await env.DB.prepare("SELECT id FROM daily_closures WHERE business_date=? LIMIT 1").bind(date).first();
      if (existing) throw new AuthError("Ese día ya tiene un corte confirmado.", 409);
      const summary = await closureSummary(date);
      const result = await env.DB.prepare(`INSERT INTO daily_closures
        (business_date, movement_count, money_in, money_out, inventory_value,
          summary_json, inventory_json, closed_by_user_id, closed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(date, summary.movementCount, summary.moneyIn, summary.moneyOut, summary.inventoryValue,
          JSON.stringify({ ...summary, inventory: undefined }), JSON.stringify(summary.inventory), user.id, user.displayName).run();
      const closureId = Number(result.meta.last_row_id);
      await recordAudit({ entityType: "daily_closure", entityId: closureId, action: "confirmar", user, after: summary });
      return Response.json({ ok: true, id: closureId }, { status: 201 });
    }

    throw new AuthError("Acción no reconocida.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
