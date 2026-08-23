-- Preparación aditiva para CIV Bloque 4B.
-- Permite que un producto tenga uno o varios proveedores sin cambiar el flujo actual.
-- Mientras exista un solo proveedor activo, se puede marcar automáticamente como preferido.

CREATE TABLE IF NOT EXISTS product_suppliers (
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
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product
  ON product_suppliers(product_id, active);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier
  ON product_suppliers(supplier_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_suppliers_preferred
  ON product_suppliers(product_id)
  WHERE preferred = 1 AND active = 1;

-- Si al momento de aplicar esta migración existe exactamente un proveedor activo,
-- se deja asociado como proveedor preferido de todos los productos activos.
INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id, preferred)
SELECT p.id, s.id, 1
FROM products p
CROSS JOIN suppliers s
WHERE p.active = 1
  AND s.active = 1
  AND (SELECT COUNT(*) FROM suppliers WHERE active = 1) = 1;
