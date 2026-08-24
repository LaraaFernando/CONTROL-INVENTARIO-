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
};

type ClientRow = { id: number; name: string; businessName: string; phone: string; address: string };
type OrderItemInput = { productId?: unknown; quantity?: unknown };

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
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo procesar el pedido." }, { status: 500 });
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

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    await ensureFieldOrderSchema();

    const [productsResult, clientsResult, ordersResult] = await Promise.all([
      env.DB.prepare(`
        SELECT id, sku, name, category, unit, sale_price AS salePrice, current_stock AS currentStock
        FROM products WHERE active = 1 ORDER BY name
      `).all<ProductRow>(),
      env.DB.prepare(`
        SELECT id, name, business_name AS businessName, phone, address
        FROM clients WHERE active = 1 ORDER BY name
      `).all<ClientRow>(),
      env.DB.prepare(`
        SELECT o.id, o.folio, o.status, o.total_amount AS totalAmount, o.created_by AS createdBy,
          o.business_date AS businessDate, o.created_at AS createdAt, c.name AS clientName,
          COUNT(i.id) AS lineCount
        FROM field_orders o
        INNER JOIN clients c ON c.id = o.client_id
        LEFT JOIN field_order_items i ON i.order_id = o.id
        GROUP BY o.id, o.folio, o.status, o.total_amount, o.created_by, o.business_date, o.created_at, c.name
        ORDER BY o.id DESC LIMIT 100
      `).all(),
    ]);

    return Response.json({
      products: productsResult.results ?? [],
      clients: clientsResult.results ?? [],
      orders: ordersResult.results ?? [],
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
    const client = await env.DB.prepare("SELECT id, name FROM clients WHERE id=? AND active=1 LIMIT 1")
      .bind(clientId).first<{ id: number; name: string }>();
    if (!client) throw new AuthError("El cliente ya no existe o está inactivo.", 404);

    const items = Array.isArray(body.items) ? body.items as OrderItemInput[] : [];
    if (!items.length) throw new AuthError("Agrega al menos un producto al pedido.", 400);

    const productsResult = await env.DB.prepare(`
      SELECT id, sku, name, category, unit, sale_price AS salePrice, current_stock AS currentStock
      FROM products WHERE active = 1
    `).all<ProductRow>();
    const products = new Map((productsResult.results ?? []).map((row) => [Number(row.id), row]));
    const lines: Array<{ productId: number; quantity: number; unitAmount: number; totalAmount: number; sku: string; name: string; currentStock: number }> = [];

    for (const item of items) {
      const productId = Number(item.productId || 0);
      const quantity = Number(item.quantity || 0);
      if (!productId || !Number.isInteger(quantity) || quantity < 1) throw new AuthError("Revisa las cantidades del pedido.", 400);
      const product = products.get(productId);
      if (!product) throw new AuthError("Uno de los productos ya no está disponible.", 404);
      if (quantity > Number(product.currentStock || 0)) {
        throw new AuthError(`${product.sku} · ${product.name}: solo hay ${product.currentStock} disponibles.`, 409);
      }
      const unitAmount = Number(product.salePrice || 0);
      lines.push({ productId, quantity, unitAmount, totalAmount: unitAmount * quantity, sku: product.sku, name: product.name, currentStock: Number(product.currentStock || 0) });
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

    return Response.json({ ok: true, orderId, folio, status: "levantado", totalAmount, lineCount: lines.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
