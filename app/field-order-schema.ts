import { env } from "cloudflare:workers";

let schemaPromise: Promise<void> | null = null;

async function addMissingFieldOrderColumns() {
  const info = await env.DB.prepare("PRAGMA table_info(field_orders)").all<{ name: string }>();
  const columns = new Set((info.results ?? []).map((row) => row.name));
  const additions = [
    ["sale_reference", "ALTER TABLE field_orders ADD COLUMN sale_reference TEXT NOT NULL DEFAULT ''"],
    ["preparing_at", "ALTER TABLE field_orders ADD COLUMN preparing_at TEXT"],
    ["dispatched_at", "ALTER TABLE field_orders ADD COLUMN dispatched_at TEXT"],
    ["delivered_at", "ALTER TABLE field_orders ADD COLUMN delivered_at TEXT"],
    ["canceled_at", "ALTER TABLE field_orders ADD COLUMN canceled_at TEXT"],
    ["canceled_reason", "ALTER TABLE field_orders ADD COLUMN canceled_reason TEXT NOT NULL DEFAULT ''"],
    ["updated_by_user_id", "ALTER TABLE field_orders ADD COLUMN updated_by_user_id INTEGER"],
    ["updated_by", "ALTER TABLE field_orders ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, sql] of additions) {
    if (!columns.has(name)) await env.DB.prepare(sql).run();
  }
}

export async function ensureFieldOrderSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.batch([
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
      ]);
      await addMissingFieldOrderColumns();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_field_orders_sale_reference ON field_orders(sale_reference)").run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export const productAvailabilitySql = `
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
