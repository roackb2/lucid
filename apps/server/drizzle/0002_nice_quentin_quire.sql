ALTER TABLE `discovery_workspaces` ADD `background_checks_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `context_consent_at` text;--> statement-breakpoint
ALTER TABLE `representative_agents` ADD `mailbox_floor_sequence` integer DEFAULT 0 NOT NULL;