CREATE TABLE `discovery_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_agent_id` text,
	`target_agent_id` text,
	`target_participant_id` text,
	`parent_sequence` integer,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `discovery_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_events_id_idx` ON `discovery_events` (`id`);--> statement-breakpoint
CREATE INDEX `discovery_events_workspace_sequence_idx` ON `discovery_events` (`workspace_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `discovery_events_actor_idx` ON `discovery_events` (`actor_agent_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `discovery_events_target_agent_idx` ON `discovery_events` (`target_agent_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `discovery_events_target_participant_idx` ON `discovery_events` (`target_participant_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `discovery_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`current_step` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`private_context` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `discovery_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_workspace_idx` ON `participants` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `representative_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`color` text NOT NULL,
	`purpose` text NOT NULL,
	`instructions` text NOT NULL,
	`conversation_id` text NOT NULL,
	`status` text NOT NULL,
	`run_count` integer NOT NULL,
	`last_seen_sequence` integer NOT NULL,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `discovery_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `representative_agents_workspace_sort_idx` ON `representative_agents` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `representative_agents_participant_idx` ON `representative_agents` (`participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `representative_agents_conversation_idx` ON `representative_agents` (`conversation_id`);