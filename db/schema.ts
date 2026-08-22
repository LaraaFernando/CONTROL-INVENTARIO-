import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  unit: text("unit").notNull().default("pieza"),
  cost: real("cost").notNull().default(0),
  salePrice: real("sale_price").notNull().default(0),
  currentStock: integer("current_stock").notNull().default(0),
  minimumStock: integer("minimum_stock").notNull().default(0),
  location: text("location").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  businessName: text("business_name").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull().references(() => products.id),
  clientId: integer("client_id").references(() => clients.id),
  type: text("type").notNull(),
  quantity: integer("quantity").notNull(),
  delta: integer("delta").notNull(),
  reference: text("reference").notNull().default(""),
  notes: text("notes").notNull().default(""),
  performedBy: text("performed_by").notNull().default(""),
  voided: integer("voided").notNull().default(0),
  voidedBy: text("voided_by").notNull().default(""),
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const creditNotes = sqliteTable("credit_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  folio: text("folio").notNull().unique(),
  clientId: integer("client_id").notNull().references(() => clients.id),
  saleReference: text("sale_reference").notNull().default(""),
  amount: real("amount").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Pendiente"),
  notes: text("notes").notNull().default(""),
  active: integer("active").notNull().default(1),
  voidedBy: text("voided_by").notNull().default(""),
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
