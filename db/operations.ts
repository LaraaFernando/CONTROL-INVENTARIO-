import { env } from "cloudflare:workers";
import { AuthError, type AuthUser } from "../app/auth";

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
    canceled_reason TEXT NOT NULL DEFAULT '',
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
    canceled INTEGER NOT NULL DEFAULT 0,
    canceled_by_user_id INTEGER,
    canceled_by TEXT NOT NULL DEFAULT '',
    canceled_at TEXT,
    cancel_reason TEXT NOT NULL DEFAULT '',
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
    canceled_reason TEXT NOT NULL DEFAULT '',
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
    void_reason TEXT NOT NULL DEFAULT '',
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
  "CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON purchase_receipt_items(receipt_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_due_status ON invoices(due_date, status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_uuid ON invoices(uuid) WHERE uuid <> ''",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invoice_folio ON invoices(folio, client_id) WHERE direction = 'cliente'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoice_folio ON invoices(folio, supplier_id) WHERE direction = 'proveedor'",
  "CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id, voided)",
  "CREATE INDEX IF NOT EXISTS idx_invoice_files_invoice ON invoice_files(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, id)",
  "CREATE INDEX IF NOT EXISTS idx_movements_source ON movements(source_type, source_id)",
] as const;

const triggerStatements = [
  `CREATE TRIGGER IF NOT EXISTS trg_products_nonnegative_stock
    BEFORE UPDATE OF current_stock ON products
    WHEN NEW.current_stock < 0
    BEGIN
      SELECT RAISE(ABORT, 'El inventario no puede quedar negativo');
    END`,
  `CREATE TRIGGER IF NOT EXISTS trg_order_item_receipt_limit
    BEFORE UPDATE OF received_quantity ON purchase_order_items
    WHEN NEW.received_quantity < 0 OR NEW.received_quantity > NEW.ordered_quantity
    BEGIN
      SELECT RAISE(ABORT, 'La recepción excede la cantidad pedida');
    END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoice_payment_limit
    BEFORE INSERT ON invoice_payments
    WHEN NEW.amount <= 0
      OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND canceled = 0)
      OR NEW.amount > COALESCE((
        SELECT total_amount - COALESCE((
          SELECT SUM(amount) FROM invoice_payments
          WHERE invoice_id = NEW.invoice_id AND voided = 0
        ), 0)
        FROM invoices WHERE id = NEW.invoice_id AND canceled = 0
      ), -1) + 0.005
    BEGIN
      SELECT RAISE(ABORT, 'El pago excede el saldo disponible');
    END`,
  `CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_update
    BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'La auditoría es inmutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_audit_events_no_delete
    BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'La auditoría no puede eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_daily_closures_no_update
    BEFORE UPDATE ON daily_closures BEGIN SELECT RAISE(ABORT, 'El corte diario es inmutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_daily_closures_no_delete
    BEFORE DELETE ON daily_closures BEGIN SELECT RAISE(ABORT, 'El corte diario no puede eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_movements_no_delete
    BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT, 'Los movimientos no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_movements_immutable_core
    BEFORE UPDATE OF product_id, client_id, type, quantity, delta, reference, notes, performed_by,
      unit_amount, total_amount, requested_quantity, pending_quantity, presentation, presentation_factor,
      performed_by_user_id, business_date, source_type, source_id, created_at ON movements
    BEGIN SELECT RAISE(ABORT, 'Los datos originales del movimiento son inmutables'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_credit_notes_no_delete
    BEFORE DELETE ON credit_notes BEGIN SELECT RAISE(ABORT, 'Las notas de crédito no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_credit_notes_immutable_core
    BEFORE UPDATE OF folio, client_id, sale_reference, amount, reason, notes, created_at ON credit_notes
    BEGIN SELECT RAISE(ABORT, 'Los datos originales de la nota de crédito son inmutables'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoices_no_delete
    BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'Las facturas no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoices_immutable_core
    BEFORE UPDATE OF direction, folio, uuid, client_id, supplier_id, purchase_order_id, payment_method,
      credit_days, issue_date, due_date, subtotal, tax_amount, total_amount, notes,
      created_by_user_id, created_by, created_at ON invoices
    BEGIN SELECT RAISE(ABORT, 'Los datos originales de la factura son inmutables'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoice_payments_no_delete
    BEFORE DELETE ON invoice_payments BEGIN SELECT RAISE(ABORT, 'Los pagos no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoice_payments_immutable_core
    BEFORE UPDATE OF invoice_id, amount, reference, paid_at, created_by_user_id, created_by, created_at ON invoice_payments
    BEGIN SELECT RAISE(ABORT, 'Los datos originales del pago son inmutables'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoice_files_no_delete
    BEFORE DELETE ON invoice_files BEGIN SELECT RAISE(ABORT, 'Los documentos fiscales no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_purchase_orders_no_delete
    BEFORE DELETE ON purchase_orders BEGIN SELECT RAISE(ABORT, 'Los pedidos no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_purchase_order_items_no_delete
    BEFORE DELETE ON purchase_order_items BEGIN SELECT RAISE(ABORT, 'Las partidas de pedido no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_purchase_order_items_immutable_core
    BEFORE UPDATE OF order_id, product_id, presentation, presentation_factor, ordered_quantity,
      unit_cost, total_amount ON purchase_order_items
    BEGIN SELECT RAISE(ABORT, 'Los datos originales de la partida son inmutables'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_purchase_receipts_no_delete
    BEFORE DELETE ON purchase_receipts BEGIN SELECT RAISE(ABORT, 'Las recepciones no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_items_no_delete
    BEFORE DELETE ON purchase_receipt_items BEGIN SELECT RAISE(ABORT, 'Las partidas recibidas no pueden eliminarse'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_products_no_delete
    BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT, 'Los productos no pueden eliminarse físicamente'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_clients_no_delete
    BEFORE DELETE ON clients BEGIN SELECT RAISE(ABORT, 'Los clientes no pueden eliminarse físicamente'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_suppliers_no_delete
    BEFORE DELETE ON suppliers BEGIN SELECT RAISE(ABORT, 'Los proveedores no pueden eliminarse físicamente'); END`,
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
  ["movements", "void_reason", "TEXT NOT NULL DEFAULT ''"],
  ["movements", "pending_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "presentation", "TEXT NOT NULL DEFAULT 'pieza'"],
  ["movements", "presentation_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["movements", "performed_by_user_id", "INTEGER"],
  ["movements", "business_date", "TEXT NOT NULL DEFAULT ''"],
  ["movements", "source_type", "TEXT NOT NULL DEFAULT ''"],
  ["movements", "source_id", "INTEGER"],
  ["credit_notes", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["credit_notes", "voided_by", "TEXT NOT NULL DEFAULT ''"],
  ["credit_notes", "voided_at", "TEXT"],
  ["credit_notes", "void_reason", "TEXT NOT NULL DEFAULT ''"],
  ["purchase_orders", "canceled_reason", "TEXT NOT NULL DEFAULT ''"],
  ["purchase_receipts", "canceled", "INTEGER NOT NULL DEFAULT 0"],
  ["purchase_receipts", "canceled_by_user_id", "INTEGER"],
  ["purchase_receipts", "canceled_by", "TEXT NOT NULL DEFAULT ''"],
  ["purchase_receipts", "canceled_at", "TEXT"],
  ["purchase_receipts", "cancel_reason", "TEXT NOT NULL DEFAULT ''"],
  ["invoices", "canceled_reason", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_payments", "void_reason", "TEXT NOT NULL DEFAULT ''"],
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
    await env.DB.batch(tableStatements.map((statement) => env.DB.prepare(statement)));
    await addMissingColumns();
    await env.DB.batch(indexStatements.map((statement) => env.DB.prepare(statement)));
    await env.DB.batch(triggerStatements.map((statement) => env.DB.prepare(statement)));
    await env.DB.prepare("PRAGMA optimize").run();
  })();
  void schemaPromise.catch(() => {
    schemaPromise = null;
  });
  return schemaPromise;
}

export async function assertBusinessDateOpen(date: string) {
  const closure = await env.DB.prepare("SELECT id FROM daily_closures WHERE business_date=? LIMIT 1")
    .bind(date).first<{ id: number }>();
  if (closure) {
    throw new AuthError(`El ${date} ya tiene un corte confirmado y no admite nuevas operaciones.`, 409);
  }
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
