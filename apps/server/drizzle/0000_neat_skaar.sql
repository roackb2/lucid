CREATE TABLE `dreamers` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`name` text NOT NULL,
	`archetype` text NOT NULL,
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
	FOREIGN KEY (`world_id`) REFERENCES `world_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dreamers_world_sort_idx` ON `dreamers` (`world_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `dreamers_conversation_id_idx` ON `dreamers` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `world_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`world_id` text NOT NULL,
	`tick` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_dreamer_id` text,
	`target_dreamer_id` text,
	`parent_sequence` integer,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_events_id_idx` ON `world_events` (`id`);--> statement-breakpoint
CREATE INDEX `world_events_world_sequence_idx` ON `world_events` (`world_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `world_events_actor_idx` ON `world_events` (`actor_dreamer_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `world_events_target_idx` ON `world_events` (`target_dreamer_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `world_states` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`current_tick` integer NOT NULL,
	`next_dreamer_index` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
