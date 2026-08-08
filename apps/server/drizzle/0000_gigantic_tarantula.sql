CREATE SCHEMA "lucid";
--> statement-breakpoint
CREATE TABLE "lucid"."discovery_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"wake_number" bigint NOT NULL,
	"kind" text NOT NULL,
	"actor_agent_id" text,
	"target_agent_id" text,
	"target_participant_id" text,
	"reply_to_sequence" bigint,
	"idempotency_key" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_events_wake_nonnegative" CHECK ("lucid"."discovery_events"."wake_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lucid"."discovery_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"version_id" text NOT NULL,
	"current_wake" bigint NOT NULL,
	"background_checks_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_workspaces_singleton_true" CHECK ("lucid"."discovery_workspaces"."singleton" = true),
	CONSTRAINT "discovery_workspaces_current_wake_nonnegative" CHECK ("lucid"."discovery_workspaces"."current_wake" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lucid"."participants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"registration_key" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"private_context" text NOT NULL,
	"context_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participants_kind_valid" CHECK ("lucid"."participants"."kind" in ('human', 'synthetic')),
	CONSTRAINT "participants_status_valid" CHECK ("lucid"."participants"."status" in ('active', 'disabled', 'retired')),
	CONSTRAINT "participants_human_consent_required" CHECK ("lucid"."participants"."kind" <> 'human' or "lucid"."participants"."context_consent_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "lucid"."representative_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"sort_order" bigint NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"color" text NOT NULL,
	"purpose" text NOT NULL,
	"instructions" text NOT NULL,
	"status" text NOT NULL,
	"run_count" bigint NOT NULL,
	"mailbox_floor_sequence" bigint DEFAULT 0 NOT NULL,
	"last_seen_sequence" bigint NOT NULL,
	"active_wake_id" text,
	"active_wake_claim_token" text,
	"active_wake_number" bigint,
	"active_wake_horizon" bigint,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "representative_agents_status_valid" CHECK ("lucid"."representative_agents"."status" in ('idle', 'running', 'error')),
	CONSTRAINT "representative_agents_counters_nonnegative" CHECK ("lucid"."representative_agents"."sort_order" >= 0 and "lucid"."representative_agents"."run_count" >= 0 and "lucid"."representative_agents"."mailbox_floor_sequence" >= 0 and "lucid"."representative_agents"."last_seen_sequence" >= 0),
	CONSTRAINT "representative_agents_wake_claim_complete" CHECK ((
        "lucid"."representative_agents"."active_wake_id" is null
        and "lucid"."representative_agents"."active_wake_claim_token" is null
        and "lucid"."representative_agents"."active_wake_number" is null
        and "lucid"."representative_agents"."active_wake_horizon" is null
      ) or (
        "lucid"."representative_agents"."active_wake_id" is not null
        and "lucid"."representative_agents"."active_wake_claim_token" is not null
        and "lucid"."representative_agents"."active_wake_number" is not null
        and "lucid"."representative_agents"."active_wake_horizon" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "lucid"."discovery_events" ADD CONSTRAINT "discovery_events_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."participants" ADD CONSTRAINT "participants_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."representative_agents" ADD CONSTRAINT "representative_agents_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."representative_agents" ADD CONSTRAINT "representative_agents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "lucid"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_events_id_idx" ON "lucid"."discovery_events" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_events_idempotency_idx" ON "lucid"."discovery_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "discovery_events_workspace_sequence_idx" ON "lucid"."discovery_events" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_actor_idx" ON "lucid"."discovery_events" USING btree ("actor_agent_id","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_target_agent_idx" ON "lucid"."discovery_events" USING btree ("target_agent_id","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_target_participant_idx" ON "lucid"."discovery_events" USING btree ("target_participant_id","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_reply_idx" ON "lucid"."discovery_events" USING btree ("reply_to_sequence","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_kind_sequence_idx" ON "lucid"."discovery_events" USING btree ("workspace_id","kind","sequence");--> statement-breakpoint
CREATE INDEX "discovery_events_metadata_gin_idx" ON "lucid"."discovery_events" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_workspaces_single_generation_idx" ON "lucid"."discovery_workspaces" USING btree ("singleton");--> statement-breakpoint
CREATE INDEX "participants_workspace_idx" ON "lucid"."participants" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_registration_key_idx" ON "lucid"."participants" USING btree ("registration_key");--> statement-breakpoint
CREATE INDEX "representative_agents_workspace_sort_idx" ON "lucid"."representative_agents" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "representative_agents_participant_idx" ON "lucid"."representative_agents" USING btree ("participant_id");