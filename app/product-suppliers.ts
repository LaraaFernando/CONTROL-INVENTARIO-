import { env } from "cloudflare:workers";

let schemaPromise: Promise<void> | null = null;

export async function ensureProductSupplierSchema() {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS product_suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        preferred INTEGER NOT NULL DEFAULT 0,
        supplier_product_code TEXT NOT NULL DEFAULT '',
        last_unit_cost REAL NOT NULL DEFAULT 0,
        lead_days INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, supplier_id)
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id, active)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers(supplier_id, active)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_product_suppliers_preferred ON product_suppliers(product_id) WHERE preferred = 1 AND active = 1"),
    ]).then(async () => {
      await syncSingleSupplierDefaults();
    }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function syncSingleSupplierDefaults() {
  const supplier = await env.DB.prepare(`
    SELECT id FROM suppliers WHERE active = 1
    AND (SELECT COUNT(*) FROM suppliers WHERE active = 1) = 1
    LIMIT 1
  `).first<{ id: number }>();
  if (!supplier) return;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id, preferred)
    SELECT p.id, ?, 1 FROM products p WHERE p.active = 1
  `).bind(supplier.id).run();

  await env.DB.prepare(`
    UPDATE product_suppliers
    SET preferred = CASE WHEN supplier_id = ? THEN 1 ELSE 0 END,
        active = CASE WHEN supplier_id = ? THEN 1 ELSE active END,
        updated_at = CURRENT_TIMESTAMP
    WHERE product_id IN (SELECT id FROM products WHERE active = 1)
  `).bind(supplier.id, supplier.id).run();
}
