import { env } from "cloudflare:workers";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { addDays, assertBusinessDateOpen, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";

type JsonBody = Record<string, unknown>;
type OrderItemInput = { productId?: unknown; quantity?: unknown; presentation?: unknown; unitCost?: unknown };
type ReceiptItemInput = { itemId?: unknown; quantity?: unknown };

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const text = error instanceof Error ? error.message : "Error inesperado";
  if (text.includes("UNIQUE constraint failed: invoices.uuid")) return Response.json({ error: "El UUID fiscal ya está registrado." }, { status: 409 });
  if (text.includes("UNIQUE constraint failed")) return Response.json({ error: "El folio ya está registrado." }, { status: 409 });
  if (text.includes("inventario no puede quedar negativo") || text.includes("recepción excede") || text.includes("pago excede")) {
    return Response.json({ error: text }, { status: 409 });
  }
  return Response.json({ error: text }, { status: 500 });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveAmount(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? Math.round((number + Number.EPSILON) * 100) / 100 : fallback;
}

function nonNegativeAmount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

function isoDate(value: unknown, fallback = "") {
  const date = text(value) || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return "";
  return date;
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
  const creditResult = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM credit_notes
    WHERE active = 1 AND status = 'Aplicada' AND substr(created_at, 1, 10) = ?
  `).bind(date).first<{ amount: number }>();

  const movements = movementResult.results ?? [];
  const payments = paymentResult.results ?? [];
  const movementCount = movements.reduce((sum, row) => sum + Number(row.count), 0);
  const sales = Number(movements.find((row) => row.type === "venta")?.amount ?? 0);
  const purchases = Number(movements.find((row) => row.type === "entrada_compra")?.amount ?? 0);
  const receivedPayments = Number(payments.find((row) => row.direction === "cliente")?.amount ?? 0);
  const sentPayments = Number(payments.find((row) => row.direction === "proveedor")?.amount ?? 0);
  const creditNotes = Number(creditResult?.amount ?? 0);
  const inventory = inventoryResult.results ?? [];
  const inventoryValue = inventory.reduce((sum, row) => sum + Number(row.inventoryValue || 0), 0);
  return {
    businessDate: date,
    movementCount,
    sales,
    purchases,
    creditNotes,
    receivedPayments,
    sentPayments,
    moneyIn: receivedPayments,
    moneyOut: sentPayments,
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
        void_reason AS voidReason, created_at AS createdAt FROM invoice_payments ORDER BY id DESC LIMIT 500`).all(),
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

    const canSeeSuppliers = user.permissions["suppliers.manage"] || user.permissions["orders.manage"] || user.permissions["invoices.manage"];
    const canSeeOrders = user.permissions["orders.manage"];
    const canSeeInvoices = user.permissions["invoices.manage"];
    const canSeeFiles = user.permissions["invoices.files"];
    const canSeeClosures = user.permissions["closures.manage"];

    return Response.json({
      suppliers: canSeeSuppliers ? supplierResult.results ?? [] : [],
      orders: canSeeOrders ? orderResult.results ?? [] : [],
      orderItems: canSeeOrders ? itemResult.results ?? [] : [],
      invoices: canSeeInvoices ? invoiceResult.results ?? [] : [],
      payments: canSeeInvoices ? paymentResult.results ?? [] : [],
      files: canSeeFiles ? fileResult.results ?? [] : [],
      closures: canSeeClosures ? closureResult.results ?? [] : [],
      audit,
      closurePreview: canSeeClosures ? await closureSummary(businessDate()) : null,
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
        days: Number(body.creditDays ?? 0),
      };
      if (values.method === "PPD" && (!Number.isInteger(values.days) || values.days < 1)) {
        throw new AuthError("Los días de crédito deben ser un número entero mayor a cero para PPD.", 400);
      }
      if (values.method === "PUE") values.days = 0;
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
      if (items.length > 200) throw new AuthError("Un pedido no puede contener más de 200 partidas.", 400);
      const supplier = await env.DB.prepare("SELECT * FROM suppliers WHERE id=? AND active=1 LIMIT 1").bind(supplierId).first<{
        default_payment_method: string; invoice_required: number; credit_days: number;
      }>();
      if (!supplier) throw new AuthError("Proveedor no encontrado.", 404);
      const method = paymentMethod(body.paymentMethod || supplier.default_payment_method);
      const requestedCreditDays = Number(body.creditDays ?? supplier.credit_days ?? 30);
      if (method === "PPD" && (!Number.isInteger(requestedCreditDays) || requestedCreditDays < 1)) {
        throw new AuthError("Los días de crédito deben ser un número entero mayor a cero para PPD.", 400);
      }
      const creditDays = method === "PUE" ? 0 : requestedCreditDays;
      const createdDate = businessDate();
      const dueDate = addDays(createdDate, creditDays);
      const expectedAt = text(body.expectedAt) ? isoDate(body.expectedAt) : "";
      if (text(body.expectedAt) && !expectedAt) throw new AuthError("La fecha esperada no es válida.", 400);
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
        const requestedPresentation = text(item.presentation).toLowerCase();
        const presentation = ["pieza", "unidad", "ciento", "juego", "caja"].includes(requestedPresentation) ? requestedPresentation : "pieza";
        const factor = factorFor(product, presentation);
        const quantity = count * factor;
        const rawUnitCost = text(item.unitCost) ? Number(item.unitCost) : Number(product.cost || 0);
        if (!Number.isFinite(rawUnitCost) || rawUnitCost < 0) throw new AuthError("El costo unitario debe ser un importe válido.", 400);
        const unitCost = Math.round((rawUnitCost + Number.EPSILON) * 100) / 100;
        normalized.push({ productId, presentation, factor, quantity, unitCost,
          total: Math.round((quantity * unitCost + Number.EPSILON) * 100) / 100 });
      }
      const total = normalized.reduce((sum, item) => sum + item.total, 0);
      const result = await env.DB.prepare(`INSERT INTO purchase_orders
        (folio, supplier_id, status, tracking_number, expected_at, payment_method, invoice_required,
          credit_days, due_date, total_amount, notes, created_by_user_id, created_by)
        VALUES (?, ?, 'pedido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(folio, supplierId, text(body.trackingNumber), expectedAt || null, method,
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
      const expectedAt = text(body.expectedAt) ? isoDate(body.expectedAt) : "";
      if (text(body.expectedAt) && !expectedAt) throw new AuthError("La fecha esperada no es válida.", 400);
      const before = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id=? LIMIT 1").bind(id).first<{ canceled: number }>();
      if (!before || before.canceled) throw new AuthError("Pedido no encontrado o cancelado.", 404);
      if (status === "entregado") {
        const pending = await env.DB.prepare(`SELECT COUNT(*) AS total FROM purchase_order_items
          WHERE order_id=? AND received_quantity < ordered_quantity`).bind(id).first<{ total: number }>();
        if (Number(pending?.total || 0) > 0) {
          throw new AuthError("El pedido solo puede marcarse como entregado cuando la recepción esté completa.", 409);
        }
      }
      await env.DB.prepare("UPDATE purchase_orders SET status=?, tracking_number=?, expected_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(status, text(body.trackingNumber), expectedAt || null, id).run();
      await recordAudit({ entityType: "purchase_order", entityId: id, action: "estatus", user, before,
        after: { status, trackingNumber: text(body.trackingNumber), expectedAt } });
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
      await env.DB.prepare(`UPDATE purchase_orders SET canceled=1, canceled_by=?, canceled_at=CURRENT_TIMESTAMP,
        canceled_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(user.displayName, reason, id).run();
      await recordAudit({ entityType: "purchase_order", entityId: id, action: "anular", user, before, after: { canceled: true }, reason });
      return Response.json({ ok: true });
    }

    if (action === "receive_order") {
      requirePermission(user, "orders.manage");
      const orderId = Number(body.orderId || 0);
      const entries = Array.isArray(body.items) ? body.items as ReceiptItemInput[] : [];
      const order = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id=? LIMIT 1").bind(orderId).first<{ id: number; folio: string; canceled: number }>();
      if (!order || order.canceled) throw new AuthError("Pedido no encontrado o cancelado.", 404);
      const date = businessDate();
      await assertBusinessDateOpen(date);
      const accepted: Array<{ itemId: number; productId: number; quantity: number; unitCost: number; newStock: number }> = [];
      const itemIds = new Set<number>();
      for (const entry of entries) {
        const itemId = Number(entry.itemId || 0);
        const quantity = positiveInteger(entry.quantity);
        if (!quantity) continue;
        if (itemIds.has(itemId)) throw new AuthError("Cada partida solo puede recibirse una vez por operación.", 400);
        itemIds.add(itemId);
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
      const statements = accepted.flatMap((entry) => [
        env.DB.prepare("INSERT INTO purchase_receipt_items (receipt_id, order_item_id, product_id, quantity) VALUES (?, ?, ?, ?)")
          .bind(receiptId, entry.itemId, entry.productId, entry.quantity),
        env.DB.prepare("UPDATE purchase_order_items SET received_quantity=received_quantity+? WHERE id=?")
          .bind(entry.quantity, entry.itemId),
        env.DB.prepare("UPDATE products SET current_stock=current_stock+? WHERE id=?").bind(entry.quantity, entry.productId),
        env.DB.prepare(`INSERT INTO movements
          (product_id, type, quantity, delta, reference, notes, performed_by, unit_amount, total_amount,
            requested_quantity, pending_quantity, presentation, presentation_factor, performed_by_user_id, business_date,
            source_type, source_id)
          VALUES (?, 'entrada_compra', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pieza', 1, ?, ?, 'purchase_receipt', ?)`)
          .bind(entry.productId, entry.quantity, entry.quantity, order.folio, `Recepción ${receiptId}`,
            user.displayName, entry.unitCost, entry.unitCost * entry.quantity, entry.quantity, user.id, date, receiptId),
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
      const clientId = direction === "cliente" ? Number(body.clientId || 0) || null : null;
      const supplierId = direction === "proveedor" ? Number(body.supplierId || 0) || null : null;
      if (!["cliente", "proveedor"].includes(direction) || !folio || (direction === "cliente" ? !clientId : !supplierId)) {
        throw new AuthError("Dirección, folio y cliente/proveedor son obligatorios.", 400);
      }
      if (direction === "cliente") {
        const client = await env.DB.prepare("SELECT id FROM clients WHERE id=? AND active=1 LIMIT 1").bind(clientId).first();
        if (!client) throw new AuthError("Cliente no encontrado o inactivo.", 404);
      } else {
        const supplier = await env.DB.prepare("SELECT id FROM suppliers WHERE id=? AND active=1 LIMIT 1").bind(supplierId).first();
        if (!supplier) throw new AuthError("Proveedor no encontrado o inactivo.", 404);
      }
      const method = paymentMethod(body.paymentMethod);
      const issueDate = isoDate(body.issueDate, businessDate());
      if (!issueDate) throw new AuthError("La fecha de emisión no es válida.", 400);
      const requestedCreditDays = Number(body.creditDays ?? 30);
      if (method === "PPD" && (!Number.isInteger(requestedCreditDays) || requestedCreditDays < 1)) {
        throw new AuthError("Los días de crédito deben ser un número entero mayor a cero para PPD.", 400);
      }
      const creditDays = method === "PUE" ? 0 : requestedCreditDays;
      const dueDate = addDays(issueDate, creditDays);
      const subtotal = nonNegativeAmount(body.subtotal);
      const taxAmount = nonNegativeAmount(body.taxAmount);
      if (subtotal === null || taxAmount === null) throw new AuthError("Subtotal e impuestos deben ser importes válidos.", 400);
      const total = positiveAmount(body.totalAmount, subtotal + taxAmount);
      if (!total) throw new AuthError("El total de la factura debe ser mayor a cero.", 400);
      const uuid = text(body.uuid).toUpperCase();
      if (uuid && !/^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(uuid)) {
        throw new AuthError("El UUID fiscal no tiene un formato válido.", 400);
      }
      const purchaseOrderId = direction === "proveedor" ? Number(body.purchaseOrderId || 0) || null : null;
      if (purchaseOrderId) {
        const purchaseOrder = await env.DB.prepare("SELECT id FROM purchase_orders WHERE id=? AND supplier_id=? AND canceled=0 LIMIT 1")
          .bind(purchaseOrderId, supplierId).first();
        if (!purchaseOrder) throw new AuthError("El pedido relacionado no pertenece al proveedor o está cancelado.", 400);
      }
      const result = await env.DB.prepare(`INSERT INTO invoices
        (direction, folio, uuid, client_id, supplier_id, purchase_order_id, payment_method,
          credit_days, issue_date, due_date, subtotal, tax_amount, total_amount, notes,
          created_by_user_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(direction, folio, uuid, clientId, supplierId,
          purchaseOrderId, method, creditDays, issueDate, dueDate,
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
      const paidAt = isoDate(body.paidAt, businessDate());
      if (!paidAt) throw new AuthError("La fecha del pago no es válida.", 400);
      await assertBusinessDateOpen(paidAt);
      const newPaid = Math.round((Number(invoice.paid_amount) + amount + Number.EPSILON) * 100) / 100;
      const status = newPaid + 0.005 >= Number(invoice.total_amount) ? "pagada" : "parcial";
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO invoice_payments
          (invoice_id, amount, reference, paid_at, created_by_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(invoiceId, amount, text(body.reference), paidAt, user.id, user.displayName),
        env.DB.prepare("UPDATE invoices SET paid_amount=?, status=? WHERE id=?").bind(newPaid, status, invoiceId),
      ]);
      const paymentId = Number(results[0].meta.last_row_id);
      await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "pago", user,
        before: { paidAmount: invoice.paid_amount }, after: { paymentId, amount, paidAt, paidAmount: newPaid, status } });
      return Response.json({ ok: true, id: paymentId }, { status: 201 });
    }

    if (action === "void_payment") {
      requirePermission(user, "invoices.manage");
      const paymentId = Number(body.paymentId || 0);
      const reason = text(body.reason);
      if (!paymentId || !reason) throw new AuthError("Pago inválido o motivo de anulación faltante.", 400);
      const payment = await env.DB.prepare(`SELECT p.*, i.total_amount, i.canceled
        FROM invoice_payments p INNER JOIN invoices i ON i.id=p.invoice_id
        WHERE p.id=? LIMIT 1`).bind(paymentId).first<{
          id: number; invoice_id: number; amount: number; paid_at: string; voided: number; total_amount: number; canceled: number;
        }>();
      if (!payment) throw new AuthError("Pago no encontrado.", 404);
      if (payment.voided) throw new AuthError("Ese pago ya fue anulado.", 409);
      if (payment.canceled) throw new AuthError("No se puede modificar una factura cancelada.", 409);
      const paidDate = isoDate(payment.paid_at.slice(0, 10));
      if (!paidDate) throw new AuthError("El pago no tiene una fecha operativa válida.", 409);
      await assertBusinessDateOpen(paidDate);
      const remaining = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM invoice_payments
        WHERE invoice_id=? AND voided=0 AND id<>?`).bind(payment.invoice_id, paymentId).first<{ total: number }>();
      const newPaid = Math.round((Number(remaining?.total || 0) + Number.EPSILON) * 100) / 100;
      const status = newPaid <= 0 ? "pendiente" : newPaid + 0.005 >= Number(payment.total_amount) ? "pagada" : "parcial";
      await env.DB.batch([
        env.DB.prepare(`UPDATE invoice_payments SET voided=1, voided_by=?, voided_at=CURRENT_TIMESTAMP,
          void_reason=? WHERE id=? AND voided=0`).bind(user.displayName, reason, paymentId),
        env.DB.prepare("UPDATE invoices SET paid_amount=?, status=? WHERE id=?")
          .bind(newPaid, status, payment.invoice_id),
      ]);
      await recordAudit({ entityType: "invoice", entityId: payment.invoice_id, action: "anular_pago", user,
        before: payment, after: { paymentId, voided: true, paidAmount: newPaid, status }, reason });
      return Response.json({ ok: true });
    }

    if (action === "cancel_invoice") {
      requirePermission(user, "invoices.manage");
      const invoiceId = Number(body.invoiceId || 0);
      const reason = text(body.reason);
      if (!invoiceId || !reason) throw new AuthError("Indica el motivo de la cancelación.", 400);
      const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id=? LIMIT 1").bind(invoiceId).first<{ canceled: number }>();
      if (!invoice) throw new AuthError("Factura no encontrada.", 404);
      if (invoice.canceled) throw new AuthError("La factura ya está cancelada.", 409);
      const activePayments = await env.DB.prepare("SELECT COUNT(*) AS total FROM invoice_payments WHERE invoice_id=? AND voided=0")
        .bind(invoiceId).first<{ total: number }>();
      if (Number(activePayments?.total || 0) > 0) {
        throw new AuthError("Anula primero los pagos activos; la factura y sus pagos conservarán toda la trazabilidad.", 409);
      }
      await env.DB.prepare(`UPDATE invoices SET canceled=1, status='cancelada', canceled_by=?,
        canceled_at=CURRENT_TIMESTAMP, canceled_reason=? WHERE id=?`)
        .bind(user.displayName, reason, invoiceId).run();
      await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "cancelar", user,
        before: invoice, after: { canceled: true, status: "cancelada" }, reason });
      return Response.json({ ok: true });
    }

    if (action === "confirm_close") {
      requirePermission(user, "closures.manage");
      const date = text(body.businessDate) || businessDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AuthError("Fecha de corte inválida.", 400);
      if (date !== businessDate()) throw new AuthError("El corte solo puede confirmarse para la fecha operativa actual.", 400);
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
