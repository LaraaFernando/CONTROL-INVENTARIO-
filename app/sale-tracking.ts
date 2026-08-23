import { env } from "cloudflare:workers";

let schemaPromise: Promise<void> | null = null;

export async function ensureSaleTrackingSchema() {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS document_sequences (
          document_type TEXT NOT NULL,
          business_date TEXT NOT NULL,
          last_number INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (document_type, business_date)
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folio TEXT NOT NULL UNIQUE,
          client_id INTEGER NOT NULL REFERENCES clients(id),
          total_amount REAL NOT NULL DEFAULT 0,
          external_reference TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_by_user_id INTEGER,
          created_by TEXT NOT NULL DEFAULT '',
          business_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sales_client_date ON sales(client_id, business_date, id)"),
    ]).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function nextSaleFolio(businessDate: string) {
  await ensureSaleTrackingSchema();
  const row = await env.DB.prepare(`
    INSERT INTO document_sequences (document_type, business_date, last_number)
    VALUES ('sale', ?, 1)
    ON CONFLICT(document_type, business_date)
    DO UPDATE SET last_number = document_sequences.last_number + 1
    RETURNING last_number AS lastNumber
  `).bind(businessDate).first<{ lastNumber: number }>();

  const sequence = Number(row?.lastNumber || 0);
  if (!sequence) throw new Error("No se pudo reservar el folio de la venta.");
  return `VTA-${businessDate.replaceAll("-", "")}-${String(sequence).padStart(6, "0")}`;
}

export async function saleProductQuantity(folio: string, clientId: number, productId: number) {
  await ensureSaleTrackingSchema();

  const tracked = await env.DB.prepare(`
    SELECT s.id
    FROM sales s
    WHERE s.folio = ? AND s.client_id = ?
    LIMIT 1
  `).bind(folio, clientId).first<{ id: number }>();

  const legacy = tracked ? true : Boolean(await env.DB.prepare(`
    SELECT 1 AS found
    FROM movements
    WHERE type = 'venta' AND voided = 0 AND reference = ? AND client_id = ?
    LIMIT 1
  `).bind(folio, clientId).first<{ found: number }>());

  if (!legacy) return { exists: false, sold: 0, returned: 0 };

  const sold = await env.DB.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM movements
    WHERE type = 'venta' AND voided = 0 AND reference = ? AND client_id = ? AND product_id = ?
  `).bind(folio, clientId, productId).first<{ quantity: number }>();

  const returned = await env.DB.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM movements
    WHERE type = 'devolucion_cliente' AND voided = 0 AND reference = ? AND client_id = ? AND product_id = ?
  `).bind(folio, clientId, productId).first<{ quantity: number }>();

  return {
    exists: true,
    sold: Number(sold?.quantity || 0),
    returned: Number(returned?.quantity || 0),
  };
}
