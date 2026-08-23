CREATE TABLE IF NOT EXISTS document_sequences (
  document_type TEXT NOT NULL,
  business_date TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_type, business_date)
);

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
);

CREATE INDEX IF NOT EXISTS idx_sales_client_date ON sales(client_id, business_date, id);
