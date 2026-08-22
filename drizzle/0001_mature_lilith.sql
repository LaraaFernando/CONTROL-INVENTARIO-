ALTER TABLE `movements` ADD `requested_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `pending_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation` text DEFAULT 'pieza' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `presentation_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `target_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `set_factor` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `box_factor` integer DEFAULT 1 NOT NULL;
