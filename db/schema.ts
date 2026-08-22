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
  targetStock: integer("target_stock").notNull().default(0),
  setFactor: integer("set_factor").notNull().default(1),
  boxFactor: integer("box_factor").notNull().default(1),
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
  invoiceRequired: integer("invoice_required").notNull().default(0),
  defaultPaymentMethod: text("default_payment_method").notNull().default("PUE"),
  creditDays: integer("credit_days").notNull().default(0),
  fiscalPostalCode: text("fiscal_postal_code").notNull().default(""),
  fiscalRegime: text("fiscal_regime").notNull().default(""),
  cfdiUse: text("cfdi_use").notNull().default("G03"),
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
  unitAmount: real("unit_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  requestedQuantity: integer("requested_quantity").notNull().default(0),
  pendingQuantity: integer("pending_quantity").notNull().default(0),
  presentation: text("presentation").notNull().default("pieza"),
  presentationFactor: integer("presentation_factor").notNull().default(1),
  performedByUserId: integer("performed_by_user_id"),
  businessDate: text("business_date").notNull().default(""),
  voided: integer("voided").notNull().default(0),
  voidedBy: text("voided_by").notNull().default(""),
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  businessName: text("business_name").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  invoiceRequired: integer("invoice_required").notNull().default(1),
  defaultPaymentMethod: text("default_payment_method").notNull().default("PPD"),
  creditDays: integer("credit_days").notNull().default(30),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  folio: text("folio").notNull().unique(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  status: text("status").notNull().default("pedido"),
  receivedStatus: text("received_status").notNull().default("sin_recibir"),
  trackingNumber: text("tracking_number").notNull().default(""),
  expectedAt: text("expected_at"),
  paymentMethod: text("payment_method").notNull().default("PUE"),
  invoiceRequired: integer("invoice_required").notNull().default(1),
  creditDays: integer("credit_days").notNull().default(0),
  dueDate: text("due_date"),
  totalAmount: real("total_amount").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdBy: text("created_by").notNull().default(""),
  canceled: integer("canceled").notNull().default(0),
  canceledBy: text("canceled_by").notNull().default(""),
  canceledAt: text("canceled_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const purchaseOrderItems = sqliteTable("purchase_order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => purchaseOrders.id),
  productId: integer("product_id").notNull().references(() => products.id),
  presentation: text("presentation").notNull().default("pieza"),
  presentationFactor: integer("presentation_factor").notNull().default(1),
  orderedQuantity: integer("ordered_quantity").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
  unitCost: real("unit_cost").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
});

export const purchaseReceipts = sqliteTable("purchase_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => purchaseOrders.id),
  receivedByUserId: integer("received_by_user_id"),
  receivedBy: text("received_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const purchaseReceiptItems = sqliteTable("purchase_receipt_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id").notNull().references(() => purchaseReceipts.id),
  orderItemId: integer("order_item_id").notNull().references(() => purchaseOrderItems.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction").notNull(),
  folio: text("folio").notNull(),
  uuid: text("uuid").notNull().default(""),
  clientId: integer("client_id").references(() => clients.id),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id),
  paymentMethod: text("payment_method").notNull().default("PUE"),
  creditDays: integer("credit_days").notNull().default(0),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date").notNull(),
  subtotal: real("subtotal").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull(),
  paidAmount: real("paid_amount").notNull().default(0),
  status: text("status").notNull().default("pendiente"),
  notes: text("notes").notNull().default(""),
  createdByUserId: integer("created_by_user_id"),
  createdBy: text("created_by").notNull().default(""),
  canceled: integer("canceled").notNull().default(0),
  canceledBy: text("canceled_by").notNull().default(""),
  canceledAt: text("canceled_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoicePayments = sqliteTable("invoice_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  amount: real("amount").notNull(),
  reference: text("reference").notNull().default(""),
  paidAt: text("paid_at").notNull(),
  createdByUserId: integer("created_by_user_id"),
  createdBy: text("created_by").notNull().default(""),
  voided: integer("voided").notNull().default(0),
  voidedBy: text("voided_by").notNull().default(""),
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoiceFiles = sqliteTable("invoice_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  size: integer("size").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id"),
  uploadedBy: text("uploaded_by").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailyClosures = sqliteTable("daily_closures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessDate: text("business_date").notNull().unique(),
  movementCount: integer("movement_count").notNull().default(0),
  moneyIn: real("money_in").notNull().default(0),
  moneyOut: real("money_out").notNull().default(0),
  inventoryValue: real("inventory_value").notNull().default(0),
  summaryJson: text("summary_json").notNull().default("{}"),
  inventoryJson: text("inventory_json").notNull().default("[]"),
  closedByUserId: integer("closed_by_user_id"),
  closedBy: text("closed_by").notNull().default(""),
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
