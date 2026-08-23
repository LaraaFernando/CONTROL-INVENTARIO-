CREATE TABLE IF NOT EXISTS sale_cancellations (
  cancel_key TEXT PRIMARY KEY,
  sale_folio TEXT NOT NULL DEFAULT '',
  movement_id INTEGER,
  canceled_by_user_id INTEGER,
  canceled_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sales ADD COLUMN voided INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN voided_by_user_id INTEGER;
ALTER TABLE sales ADD COLUMN voided_by TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN voided_at TEXT;
ALTER TABLE sales ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sale_cancellations_folio ON sale_cancellations(sale_folio, created_at);
