ALTER TABLE `participants` ADD `registration_key` text;--> statement-breakpoint
UPDATE `participants` SET `registration_key` = 'local-user' WHERE `id` = 'local-user';--> statement-breakpoint
DELETE FROM `participants` WHERE `id` IN ('sample-music-maker', 'sample-product-researcher');--> statement-breakpoint
UPDATE `discovery_workspaces` SET `background_checks_enabled` = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `participants_registration_key_idx` ON `participants` (`registration_key`);
