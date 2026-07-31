CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`sigil` text NOT NULL,
	`color` text NOT NULL,
	`purpose` text NOT NULL,
	`persona` text NOT NULL,
	`conversation_id` text NOT NULL,
	`status` text NOT NULL,
	`wake_count` integer NOT NULL,
	`last_seen_sequence` integer NOT NULL,
	`last_awake_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `network_states`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_network_sort_idx` ON `agents` (`network_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_principal_id_idx` ON `agents` (`principal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_conversation_id_idx` ON `agents` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `network_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`network_id` text NOT NULL,
	`tick` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_agent_id` text,
	`target_agent_id` text,
	`target_principal_id` text,
	`parent_sequence` integer,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `network_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `network_events_id_idx` ON `network_events` (`id`);--> statement-breakpoint
CREATE INDEX `network_events_network_sequence_idx` ON `network_events` (`network_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `network_events_actor_idx` ON `network_events` (`actor_agent_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `network_events_target_agent_idx` ON `network_events` (`target_agent_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `network_events_target_principal_idx` ON `network_events` (`target_principal_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `network_states` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`current_tick` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `principals` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`private_context` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `network_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `principals_network_idx` ON `principals` (`network_id`);