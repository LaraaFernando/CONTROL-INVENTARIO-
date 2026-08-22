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
CREATE UNIQUE INDEX `daily_closures_business_date_unique` ON `daily_closures` (`business_date`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `invoice_files_storage_key_unique` ON `invoice_files` (`storage_key`);--> statement-breakpoint
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
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_folio_unique` ON `purchase_orders` (`folio`);--> statement-breakpoint
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
ALTER TABLE `clients` ADD `invoice_required` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `default_payment_method` text DEFAULT 'PUE' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `credit_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `fiscal_postal_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `fiscal_regime` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `cfdi_use` text DEFAULT 'G03' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `requested_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `pending_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation` text DEFAULT 'pieza' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `performed_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `movements` ADD `business_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `target_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `set_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `box_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_orders_supplier_status` ON `purchase_orders` (`supplier_id`, `status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_items_order` ON `purchase_order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipts_order` ON `purchase_receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoices_due_status` ON `invoices` (`due_date`, `status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_invoice_files_invoice` ON `invoice_files` (`invoice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_entity` ON `audit_events` (`entity_type`, `entity_id`, `id`);
