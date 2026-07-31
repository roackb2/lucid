ALTER TABLE `discovery_events` RENAME COLUMN "step_number" TO "wake_number";--> statement-breakpoint
ALTER TABLE `discovery_workspaces` RENAME COLUMN "current_step" TO "current_wake";--> statement-breakpoint
UPDATE `discovery_events`
SET `kind` = CASE `kind`
  WHEN 'agent_step_started' THEN 'agent_wake_started'
  WHEN 'agent_step_completed' THEN 'agent_wake_completed'
  WHEN 'no_action' THEN 'agent_wake_no_action'
  ELSE `kind`
END;--> statement-breakpoint
ALTER TABLE `discovery_events` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_events_idempotency_idx` ON `discovery_events` (`idempotency_key`);--> statement-breakpoint
DROP INDEX `representative_agents_conversation_idx`;--> statement-breakpoint
ALTER TABLE `representative_agents` ADD `active_wake_id` text;--> statement-breakpoint
ALTER TABLE `representative_agents` ADD `active_wake_number` integer;--> statement-breakpoint
ALTER TABLE `representative_agents` ADD `active_wake_horizon` integer;--> statement-breakpoint
ALTER TABLE `representative_agents` DROP COLUMN `conversation_id`;
