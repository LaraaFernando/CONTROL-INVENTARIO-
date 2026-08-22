import { env } from "cloudflare:workers";
import type { AuthUser } from "../app/auth";

let schemaPromise: Promise<void> | null = null;

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    business_name TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    invoice_required INTEGER NOT NULL DEFAULT 1,
    default_payment_method TEXT NOT NULL DEFAULT 'PPD',
    credit_days INTEGER NOT NULL DEFAULT 30,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'pedido',
    received_status TEXT NOT NULL DEFAULT 'sin_recibir',
    tracking_number TEXT NOT NULL DEFAULT '',
    expected_at TEXT,
    payment_method TEXT NOT NULL DEFAULT 'PUE',
    invoice_required INTEGER NOT NULL DEFAULT 1,
    credit_days INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    total_amount REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by_user_id INTEGER,
    created_by TEXT NOT NULL DEFAULT '',
    canceled INTEGER NOT NULL DEFAULT 0,
    canceled_by TEXT NOT NULL DEFAULT '',
    canceled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    presentation TEXT NOT NULL DEFAULT 'pieza',
    presentation_factor INTEGER NOT NULL DEFAULT 1,
    ordered_quantity INTEGER NOT NULL,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    received_by_user_id INTEGER,
    received_by TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL REFERENCES purchase_receipts(id),
    order_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    folio TEXT NOT NULL,
    uuid TEXT NOT NULL DEFAULT '',
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    purchase_order_id INTEGER REFERENCES purchase_orders(id),
    payment_method TEXT NOT NULL DEFAULT 'PUE',
    credit_days INTEGER NOT NULL DEFAULT 0,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pendiente',
    notes TEXT NOT NULL DEFAULT '',
    created_by_user_id INTEGER,
    created_by TEXT NOT NULL DEFAULT '',
    canceled INTEGER NOT NULL DEFAULT 0,
    canceled_by TEXT NOT NULL DEFAULT '',
    canceled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    amount REAL NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    created_by TEXT NOT NULL DEFAULT '',
    voided INTEGER NOT NULL DEFAULT 0,
    voided_by TEXT NOT NULL DEFAULT '',
    voided_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    uploaded_by_user_id INTEGER,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,
    username TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS daily_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date TEXT NOT NULL UNIQUE,
    movement_count INTEGER NOT NULL DEFAULT 0,
    money_in REAL NOT NULL DEFAULT 0,
    money_out REAL NOT NULL DEFAULT 0,
    inventory_value REAL NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    closed_by_user_id INTEGER,
    closed_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
] as const;

const indexStatements = [
  "CREATE INDEX IF NOT EXISTS idx_orders_supplier_status ON purchase_orders(supplier_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_order_items_order ON purchase_order_items(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_receipts_order ON purchase_receipts(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_due_status ON invoices(due_date, status)",
  "CREATE INDEX IF NOT EXISTS idx_invoice_files_invoice ON invoice_files(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, id)",
] as const;

const additiveColumns = [
  ["products", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["products", "target_stock", "INTEGER NOT NULL DEFAULT 0"],
  ["products", "set_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["products", "box_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["clients", "invoice_required", "INTEGER NOT NULL DEFAULT 0"],
  ["clients", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["clients", "default_payment_method", "TEXT NOT NULL DEFAULT 'PUE'"],
  ["clients", "credit_days", "INTEGER NOT NULL DEFAULT 0"],
  ["clients", "fiscal_postal_code", "TEXT NOT NULL DEFAULT ''"],
  ["clients", "fiscal_regime", "TEXT NOT NULL DEFAULT ''"],
  ["clients", "cfdi_use", "TEXT NOT NULL DEFAULT 'G03'"],
  ["movements", "requested_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "unit_amount", "REAL NOT NULL DEFAULT 0"],
  ["movements", "total_amount", "REAL NOT NULL DEFAULT 0"],
  ["movements", "voided", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "voided_by", "TEXT NOT NULL DEFAULT ''"],
  ["movements", "voided_at", "TEXT"],
  ["movements", "pending_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "presentation", "TEXT NOT NULL DEFAULT 'pieza'"],
  ["movements", "presentation_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["movements", "performed_by_user_id", "INTEGER"],
  ["movements", "business_date", "TEXT NOT NULL DEFAULT ''"],
  ["credit_notes", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["credit_notes", "voided_by", "TEXT NOT NULL DEFAULT ''"],
  ["credit_notes", "voided_at", "TEXT"],
] as const;

async function addMissingColumns() {
  for (const [table, column, definition] of additiveColumns) {
    const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!(result.results ?? []).some((item) => item.name === column)) {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }
}

export function ensureOperationalSchema() {
  schemaPromise ??= (async () => {
    await addMissingColumns();
    await env.DB.batch(tableStatements.map((statement) => env.DB.prepare(statement)));
    await env.DB.batch(indexStatements.map((statement) => env.DB.prepare(statement)));
  })();
  return schemaPromise;
}

export function businessDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function recordAudit(input: {
  entityType: string;
  entityId: number;
  action: string;
  user: AuthUser;
  before?: unknown;
  after?: unknown;
  reason?: string;
}) {
  await env.DB.prepare(`
    INSERT INTO audit_events
      (entity_type, entity_id, action, user_id, username, display_name, before_json, after_json, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.entityType,
    input.entityId,
    input.action,
    input.user.id,
    input.user.username,
    input.user.displayName,
    JSON.stringify(input.before ?? {}),
    JSON.stringify(input.after ?? {}),
    input.reason ?? "",
  ).run();
}
