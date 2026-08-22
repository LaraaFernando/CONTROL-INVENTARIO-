CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`user_id` integer,
	`username` text DEFAULT '' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--> statement-breakpoint
CREATE TABLE `daily_closures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_date` text NOT NULL,
	`movement_count` integer DEFAULT 0 NOT NULL,
	`money_in` real DEFAULT 0 NOT NULL,
	`money_out` real DEFAULT 0 NOT NULL,
	`inventory_value` real DEFAULT 0 NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`inventory_json` text DEFAULT '[]' NOT NULL,
	`closed_by_user_id` integer,
	`closed_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closures_business_date_unique` ON `daily_closures` (`business_date`);
--> statement-breakpoint
CREATE TABLE `invoice_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by_user_id` integer,
	`uploaded_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_files_storage_key_unique` ON `invoice_files` (`storage_key`);
--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount` real NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`paid_at` text NOT NULL,
	`created_by_user_id` integer,
	`created_by` text DEFAULT '' NOT NULL,
	`voided` integer DEFAULT 0 NOT NULL,
	`voided_by` text DEFAULT '' NOT NULL,
	`voided_at` text,
	`void_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`folio` text NOT NULL,
	`uuid` text DEFAULT '' NOT NULL,
	`client_id` integer,
	`supplier_id` integer,
	`purchase_order_id` integer,
	`payment_method` text DEFAULT 'PUE' NOT NULL,
	`credit_days` integer DEFAULT 0 NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_user_id` integer,
	`created_by` text DEFAULT '' NOT NULL,
	`canceled` integer DEFAULT 0 NOT NULL,
	`canceled_by` text DEFAULT '' NOT NULL,
	`canceled_at` text,
	`canceled_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`presentation` text DEFAULT 'pieza' NOT NULL,
	`presentation_factor` integer DEFAULT 1 NOT NULL,
	`ordered_quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folio` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`status` text DEFAULT 'pedido' NOT NULL,
	`received_status` text DEFAULT 'sin_recibir' NOT NULL,
	`tracking_number` text DEFAULT '' NOT NULL,
	`expected_at` text,
	`payment_method` text DEFAULT 'PUE' NOT NULL,
	`invoice_required` integer DEFAULT 1 NOT NULL,
	`credit_days` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`total_amount` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_user_id` integer,
	`created_by` text DEFAULT '' NOT NULL,
	`canceled` integer DEFAULT 0 NOT NULL,
	`canceled_by` text DEFAULT '' NOT NULL,
	`canceled_at` text,
	`canceled_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_folio_unique` ON `purchase_orders` (`folio`);
--> statement-breakpoint
CREATE TABLE `purchase_receipt_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`order_item_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `purchase_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `purchase_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `purchase_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`received_by_user_id` integer,
	`received_by` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`canceled` integer DEFAULT 0 NOT NULL,
	`canceled_by_user_id` integer,
	`canceled_by` text DEFAULT '' NOT NULL,
	`canceled_at` text,
	`cancel_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`invoice_required` integer DEFAULT 1 NOT NULL,
	`default_payment_method` text DEFAULT 'PPD' NOT NULL,
	`credit_days` integer DEFAULT 30 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--> statement-breakpoint
ALTER TABLE `clients` ADD `invoice_required` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `default_payment_method` text DEFAULT 'PUE' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `credit_days` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `fiscal_postal_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `fiscal_regime` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `cfdi_use` text DEFAULT 'G03' NOT NULL;
--> statement-breakpoint
ALTER TABLE `credit_notes` ADD `void_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `movements` ADD `performed_by_user_id` integer;
--> statement-breakpoint
ALTER TABLE `movements` ADD `business_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `movements` ADD `void_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `movements` ADD `source_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `movements` ADD `source_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_orders_supplier_status` ON `purchase_orders` (`supplier_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_items_order` ON `purchase_order_items` (`order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipts_order` ON `purchase_receipts` (`order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_items_receipt` ON `purchase_receipt_items` (`receipt_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoices_due_status` ON `invoices` (`due_date`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_invoices_uuid` ON `invoices` (`uuid`) WHERE `uuid` <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_customer_invoice_folio` ON `invoices` (`folio`, `client_id`) WHERE `direction` = 'cliente';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_supplier_invoice_folio` ON `invoices` (`folio`, `supplier_id`) WHERE `direction` = 'proveedor';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_payments_invoice` ON `invoice_payments` (`invoice_id`, `voided`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_files_invoice` ON `invoice_files` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_entity` ON `audit_events` (`entity_type`, `entity_id`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_movements_source` ON `movements` (`source_type`, `source_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_products_nonnegative_stock`
BEFORE UPDATE OF `current_stock` ON `products`
WHEN NEW.`current_stock` < 0
BEGIN SELECT RAISE(ABORT, 'El inventario no puede quedar negativo'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_order_item_receipt_limit`
BEFORE UPDATE OF `received_quantity` ON `purchase_order_items`
WHEN NEW.`received_quantity` < 0 OR NEW.`received_quantity` > NEW.`ordered_quantity`
BEGIN SELECT RAISE(ABORT, 'La recepción excede la cantidad pedida'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoice_payment_limit`
BEFORE INSERT ON `invoice_payments`
WHEN NEW.`amount` <= 0
  OR NOT EXISTS (SELECT 1 FROM `invoices` WHERE `id` = NEW.`invoice_id` AND `canceled` = 0)
  OR NEW.`amount` > COALESCE((
    SELECT `total_amount` - COALESCE((
      SELECT SUM(`amount`) FROM `invoice_payments`
      WHERE `invoice_id` = NEW.`invoice_id` AND `voided` = 0
    ), 0)
    FROM `invoices` WHERE `id` = NEW.`invoice_id` AND `canceled` = 0
  ), -1) + 0.005
BEGIN SELECT RAISE(ABORT, 'El pago excede el saldo disponible'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_audit_events_no_update`
BEFORE UPDATE ON `audit_events` BEGIN SELECT RAISE(ABORT, 'La auditoría es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_audit_events_no_delete`
BEFORE DELETE ON `audit_events` BEGIN SELECT RAISE(ABORT, 'La auditoría no puede eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_daily_closures_no_update`
BEFORE UPDATE ON `daily_closures` BEGIN SELECT RAISE(ABORT, 'El corte diario es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_daily_closures_no_delete`
BEFORE DELETE ON `daily_closures` BEGIN SELECT RAISE(ABORT, 'El corte diario no puede eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_movements_no_delete`
BEFORE DELETE ON `movements` BEGIN SELECT RAISE(ABORT, 'Los movimientos no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_movements_immutable_core`
BEFORE UPDATE OF `product_id`, `client_id`, `type`, `quantity`, `delta`, `reference`, `notes`, `performed_by`,
  `unit_amount`, `total_amount`, `requested_quantity`, `pending_quantity`, `presentation`, `presentation_factor`,
  `performed_by_user_id`, `business_date`, `source_type`, `source_id`, `created_at` ON `movements`
BEGIN SELECT RAISE(ABORT, 'Los datos originales del movimiento son inmutables'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_credit_notes_no_delete`
BEFORE DELETE ON `credit_notes` BEGIN SELECT RAISE(ABORT, 'Las notas de crédito no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_credit_notes_immutable_core`
BEFORE UPDATE OF `folio`, `client_id`, `sale_reference`, `amount`, `reason`, `notes`, `created_at` ON `credit_notes`
BEGIN SELECT RAISE(ABORT, 'Los datos originales de la nota de crédito son inmutables'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoices_no_delete`
BEFORE DELETE ON `invoices` BEGIN SELECT RAISE(ABORT, 'Las facturas no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoices_immutable_core`
BEFORE UPDATE OF `direction`, `folio`, `uuid`, `client_id`, `supplier_id`, `purchase_order_id`, `payment_method`,
  `credit_days`, `issue_date`, `due_date`, `subtotal`, `tax_amount`, `total_amount`, `notes`,
  `created_by_user_id`, `created_by`, `created_at` ON `invoices`
BEGIN SELECT RAISE(ABORT, 'Los datos originales de la factura son inmutables'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoice_payments_no_delete`
BEFORE DELETE ON `invoice_payments` BEGIN SELECT RAISE(ABORT, 'Los pagos no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoice_payments_immutable_core`
BEFORE UPDATE OF `invoice_id`, `amount`, `reference`, `paid_at`, `created_by_user_id`, `created_by`, `created_at` ON `invoice_payments`
BEGIN SELECT RAISE(ABORT, 'Los datos originales del pago son inmutables'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_invoice_files_no_delete`
BEFORE DELETE ON `invoice_files` BEGIN SELECT RAISE(ABORT, 'Los documentos fiscales no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_purchase_orders_no_delete`
BEFORE DELETE ON `purchase_orders` BEGIN SELECT RAISE(ABORT, 'Los pedidos no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_purchase_order_items_no_delete`
BEFORE DELETE ON `purchase_order_items` BEGIN SELECT RAISE(ABORT, 'Las partidas de pedido no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_purchase_order_items_immutable_core`
BEFORE UPDATE OF `order_id`, `product_id`, `presentation`, `presentation_factor`, `ordered_quantity`, `unit_cost`, `total_amount`
ON `purchase_order_items` BEGIN SELECT RAISE(ABORT, 'Los datos originales de la partida son inmutables'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_purchase_receipts_no_delete`
BEFORE DELETE ON `purchase_receipts` BEGIN SELECT RAISE(ABORT, 'Las recepciones no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_purchase_receipt_items_no_delete`
BEFORE DELETE ON `purchase_receipt_items` BEGIN SELECT RAISE(ABORT, 'Las partidas recibidas no pueden eliminarse'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_products_no_delete`
BEFORE DELETE ON `products` BEGIN SELECT RAISE(ABORT, 'Los productos no pueden eliminarse físicamente'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_clients_no_delete`
BEFORE DELETE ON `clients` BEGIN SELECT RAISE(ABORT, 'Los clientes no pueden eliminarse físicamente'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_suppliers_no_delete`
BEFORE DELETE ON `suppliers` BEGIN SELECT RAISE(ABORT, 'Los proveedores no pueden eliminarse físicamente'); END;
--> statement-breakpoint
PRAGMA optimize;
