import { env } from "cloudflare:workers";
import { businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requireUser } from "../../auth";

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  salePrice: number;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
};

type ClientRow = { id: number; name: string; businessName: string; phone: string; address: string };
type OrderItemInput = { productId?: unknown; quantity?: unknown };
type OrderItemRow = {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  sku: string;
  productName: string;
  unit: string;
};

type OrderRow = {
  id: number;
  folio: string;
  status: string;
  totalAmount: number;
  notes: string;
  createdBy: string;
  businessDate: string;
  createdAt: string;
  clientName: string;
  clientPhone: string;
  lineCount: number;
};

let schemaPromise: Promise<void> | null = null;

async function ensureFieldOrderSchema() {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS field_order_sequences (
          business_date TEXT PRIMARY KEY,
          last_number INTEGER NOT NULL DEFAULT 0
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS field_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folio TEXT NOT NULL UNIQUE,
          client_id INTEGER NOT NULL REFERENCES clients(id),
          status TEXT NOT NULL DEFAULT 'levantado',
          total_amount REAL NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          created_by_user_id INTEGER,
          created_by TEXT NOT NULL DEFAULT '',
          business_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS field_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES field_orders(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL,
          unit_amount REAL NOT NULL DEFAULT 0,
          total_amount REAL NOT NULL DEFAULT 0
        )
      `),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_field_orders_status ON field_orders(status, id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_field_order_items_order ON field_order_items(order_id, id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_field_order_items_product ON field_order_items(product_id, order_id)"),
      env.DB.prepare(`
        CREATE TRIGGER IF NOT EXISTS trg_field_order_items_reservation_insert
        BEFORE INSERT ON field_order_items
        FOR EACH ROW
        WHEN NEW.quantity > (
          SELECT MAX(0, p.current_stock - COALESCE((
            SELECT SUM(i.quantity)
            FROM field_order_items i
            INNER JOIN field_orders o ON o.id = i.order_id
            WHERE i.product_id = NEW.product_id
              AND o.status IN ('levantado', 'preparando')
          ), 0))
          FROM products p
          WHERE p.id = NEW.product_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'stock_reservado_insuficiente');
        END
      `),
    ]).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "No se pudo procesar el pedido.";
  if (message.includes("stock_reservado_insuficiente")) {
    return Response.json({ error: "La disponibilidad cambió porque otro pedido apartó mercancía. Actualiza y vuelve a intentarlo." }, { status: 409 });
  }
  return Response.json({ error: message }, { status: 500 });
}

async function nextOrderFolio(date: string) {
  const row = await env.DB.prepare(`
    INSERT INTO field_order_sequences (business_date, last_number)
    VALUES (?, 1)
    ON CONFLICT(business_date)
    DO UPDATE SET last_number = field_order_sequences.last_number + 1
    RETURNING last_number AS lastNumber
  `).bind(date).first<{ lastNumber: number }>();
  const sequence = Number(row?.lastNumber || 0);
  if (!sequence) throw new Error("No se pudo reservar el folio del pedido.");
  return `PED-${date.replaceAll("-", "")}-${String(sequence).padStart(6, "0")}`;
}

const productAvailabilitySql = `
  SELECT
    p.id,
    p.sku,
    p.name,
    p.category,
    p.unit,
    p.sale_price AS salePrice,
    p.current_stock AS currentStock,
    COALESCE((
      SELECT SUM(i.quantity)
      FROM field_order_items i
      INNER JOIN field_orders o ON o.id = i.order_id
      WHERE i.product_id = p.id
        AND o.status IN ('levantado', 'preparando')
    ), 0) AS reservedStock,
    MAX(0, p.current_stock - COALESCE((
      SELECT SUM(i.quantity)
      FROM field_order_items i
      INNER JOIN field_orders o ON o.id = i.order_id
      WHERE i.product_id = p.id
        AND o.status IN ('levantado', 'preparando')
    ), 0)) AS availableStock
  FROM products p
  WHERE p.active = 1
`;

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    await ensureFieldOrderSchema();

    const [productsResult, clientsResult, ordersResult, orderItemsResult] = await Promise.all([
      env.DB.prepare(`${productAvailabilitySql} ORDER BY p.name`).all<ProductRow>(),
      env.DB.prepare(`
        SELECT id, name, business_name AS businessName, phone, address
        FROM clients WHERE active = 1 ORDER BY name
      `).all<ClientRow>(),
      env.DB.prepare(`
        SELECT o.id, o.folio, o.status, o.total_amount AS totalAmount, o.notes,
          o.created_by AS createdBy, o.business_date AS businessDate, o.created_at AS createdAt,
          c.name AS clientName, c.phone AS clientPhone, COUNT(i.id) AS lineCount
        FROM field_orders o
        INNER JOIN clients c ON c.id = o.client_id
        LEFT JOIN field_order_items i ON i.order_id = o.id
        GROUP BY o.id, o.folio, o.status, o.total_amount, o.notes, o.created_by,
          o.business_date, o.created_at, c.name, c.phone
        ORDER BY o.id DESC LIMIT 100
      `).all<OrderRow>(),
      env.DB.prepare(`
        SELECT i.id, i.order_id AS orderId, i.product_id AS productId, i.quantity,
          i.unit_amount AS unitAmount, i.total_amount AS totalAmount,
          p.sku, p.name AS productName, p.unit
        FROM field_order_items i
        INNER JOIN products p ON p.id = i.product_id
        WHERE i.order_id IN (SELECT id FROM field_orders ORDER BY id DESC LIMIT 100)
        ORDER BY i.order_id DESC, i.id
      `).all<OrderItemRow>(),
    ]);

    const orderItems = orderItemsResult.results ?? [];
    const orders = (ordersResult.results ?? []).map((row) => ({
      ...row,
      id: Number(row.id),
      totalAmount: Number(row.totalAmount || 0),
      lineCount: Number(row.lineCount || 0),
      items: orderItems
        .filter((item) => Number(item.orderId) === Number(row.id))
        .map((item) => ({
          ...item,
          id: Number(item.id),
          orderId: Number(item.orderId),
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitAmount: Number(item.unitAmount || 0),
          totalAmount: Number(item.totalAmount || 0),
        })),
    }));

    return Response.json({
      products: (productsResult.results ?? []).map((row) => ({
        ...row,
        currentStock: Number(row.currentStock || 0),
        reservedStock: Number(row.reservedStock || 0),
        availableStock: Number(row.availableStock || 0),
      })),
      clients: clientsResult.results ?? [],
      orders,
      canCreateOrder: Boolean(user.permissions["movements.sale"] || user.permissions["orders.manage"]),
      canCreateClient: Boolean(user.permissions["clients.create"]),
      currentUser: { id: user.id, displayName: user.displayName },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    await ensureFieldOrderSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action);

    if (action === "create_client") {
      if (!user.permissions["clients.create"]) throw new AuthError("No tienes permiso para registrar clientes.", 403);
      const name = text(body.name);
      if (!name) throw new AuthError("Escribe el nombre del cliente o negocio.", 400);
      const businessName = text(body.businessName);
      const phone = text(body.phone);
      const address = text(body.address);
      const result = await env.DB.prepare(`
        INSERT INTO clients
          (name, business_name, phone, address, tax_id, email, invoice_required, default_payment_method,
           credit_days, fiscal_postal_code, fiscal_regime, cfdi_use, active)
        VALUES (?, ?, ?, ?, '', '', 0, 'PUE', 0, '', '', 'G03', 1)
      `).bind(name, businessName, phone, address).run();
      const clientId = Number(result.meta.last_row_id || 0);
      if (clientId) {
        await recordAudit({ entityType: "client", entityId: clientId, action: "crear_desde_pedido", user, after: { name, businessName, phone, address } });
      }
      return Response.json({ ok: true, client: { id: clientId, name, businessName, phone, address } }, { status: 201 });
    }

    if (action !== "create_order") throw new AuthError("Acción no válida.", 400);
    if (!(user.permissions["movements.sale"] || user.permissions["orders.manage"])) {
      throw new AuthError("No tienes permiso para levantar pedidos.", 403);
    }

    const clientId = Number(body.clientId || 0);
    if (!clientId) throw new AuthError("Selecciona un cliente antes de enviar el pedido.", 400);
    const client = await env.DB.prepare("SELECT id, name, phone FROM clients WHERE id=? AND active=1 LIMIT 1")
      .bind(clientId).first<{ id: number; name: string; phone: string }>();
    if (!client) throw new AuthError("El cliente ya no existe o está inactivo.", 404);

    const items = Array.isArray(body.items) ? body.items as OrderItemInput[] : [];
    if (!items.length) throw new AuthError("Agrega al menos un producto al pedido.", 400);

    const requestedByProduct = new Map<number, number>();
    for (const item of items) {
      const productId = Number(item.productId || 0);
      const quantity = Number(item.quantity || 0);
      if (!productId || !Number.isInteger(quantity) || quantity < 1) throw new AuthError("Revisa las cantidades del pedido.", 400);
      requestedByProduct.set(productId, (requestedByProduct.get(productId) ?? 0) + quantity);
    }

    const productsResult = await env.DB.prepare(productAvailabilitySql).all<ProductRow>();
    const products = new Map((productsResult.results ?? []).map((row) => [Number(row.id), row]));
    const lines: Array<{ productId: number; quantity: number; unitAmount: number; totalAmount: number; sku: string; name: string; unit: string; currentStock: number; reservedStock: number; availableStock: number }> = [];

    for (const [productId, quantity] of requestedByProduct) {
      const product = products.get(productId);
      if (!product) throw new AuthError("Uno de los productos ya no está disponible.", 404);
      const availableStock = Number(product.availableStock || 0);
      if (quantity > availableStock) {
        throw new AuthError(`${product.sku} · ${product.name}: solo hay ${availableStock} disponibles; ${Number(product.reservedStock || 0)} ya están apartados.`, 409);
      }
      const unitAmount = Number(product.salePrice || 0);
      lines.push({
        productId,
        quantity,
        unitAmount,
        totalAmount: unitAmount * quantity,
        sku: product.sku,
        name: product.name,
        unit: product.unit || "pieza",
        currentStock: Number(product.currentStock || 0),
        reservedStock: Number(product.reservedStock || 0),
        availableStock,
      });
    }

    const date = businessDate();
    const folio = await nextOrderFolio(date);
    const notes = text(body.notes);
    const totalAmount = lines.reduce((sum, line) => sum + line.totalAmount, 0);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO field_orders
          (folio, client_id, status, total_amount, notes, created_by_user_id, created_by, business_date)
        VALUES (?, ?, 'levantado', ?, ?, ?, ?, ?)
      `).bind(folio, clientId, totalAmount, notes, user.id, user.displayName, date),
    ];
    lines.forEach((line) => {
      statements.push(env.DB.prepare(`
        INSERT INTO field_order_items (order_id, product_id, quantity, unit_amount, total_amount)
        VALUES ((SELECT id FROM field_orders WHERE folio = ?), ?, ?, ?, ?)
      `).bind(folio, line.productId, line.quantity, line.unitAmount, line.totalAmount));
    });
    const results = await env.DB.batch(statements);
    const orderId = Number(results[0]?.meta.last_row_id || 0);
    if (orderId) {
      await recordAudit({
        entityType: "field_order",
        entityId: orderId,
        action: "levantar",
        user,
        after: { folio, clientId, clientName: client.name, status: "levantado", totalAmount, notes, items: lines },
      });
    }

    return Response.json({
      ok: true,
      orderId,
      folio,
      status: "levantado",
      totalAmount,
      lineCount: lines.length,
      clientName: client.name,
      clientPhone: client.phone || "",
      notes,
      createdBy: user.displayName,
      items: lines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        productName: line.name,
        unit: line.unit,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        totalAmount: line.totalAmount,
      })),
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
