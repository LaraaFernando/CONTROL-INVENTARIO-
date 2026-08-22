ALTER TABLE `clients` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD `voided_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_notes` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `movements` ADD `unit_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `total_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `requested_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `pending_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation` text DEFAULT 'pieza' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `voided` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `voided_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `target_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `set_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `box_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `active` integer DEFAULT 1 NOT NULL;
