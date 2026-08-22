import { env } from "cloudflare:workers";

let schemaPromise: Promise<void> | null = null;

const columns = [
  ["clients", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["credit_notes", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["credit_notes", "voided_by", "TEXT NOT NULL DEFAULT ''"],
  ["credit_notes", "voided_at", "TEXT"],
  ["movements", "unit_amount", "REAL NOT NULL DEFAULT 0"],
  ["movements", "total_amount", "REAL NOT NULL DEFAULT 0"],
  ["products", "target_stock", "INTEGER NOT NULL DEFAULT 0"],
  ["products", "set_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["products", "box_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["products", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["movements", "requested_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "pending_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "presentation", "TEXT NOT NULL DEFAULT 'pieza'"],
  ["movements", "presentation_factor", "INTEGER NOT NULL DEFAULT 1"],
  ["movements", "voided", "INTEGER NOT NULL DEFAULT 0"],
  ["movements", "voided_by", "TEXT NOT NULL DEFAULT ''"],
  ["movements", "voided_at", "TEXT"],
] as const;

export function ensureInventorySchema() {
  schemaPromise ??= (async () => {
    for (const [table, column, definition] of columns) {
      const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      if (!result.results.some((item) => item.name === column)) {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      }
    }
  })();
  return schemaPromise;
}
