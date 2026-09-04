CREATE TABLE "lucid"."agent_job_publishing_preferences" (
	"agent_job_id" text PRIMARY KEY NOT NULL,
	"region" text,
	"intended_audience" text,
	"tone" text,
	"source_guidance" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_job_publishing_preferences_region_valid" CHECK ("lucid"."agent_job_publishing_preferences"."region" is null or (char_length("lucid"."agent_job_publishing_preferences"."region") between 1 and 240 and "lucid"."agent_job_publishing_preferences"."region" = btrim("lucid"."agent_job_publishing_preferences"."region"))),
	CONSTRAINT "agent_job_publishing_preferences_audience_valid" CHECK ("lucid"."agent_job_publishing_preferences"."intended_audience" is null or (char_length("lucid"."agent_job_publishing_preferences"."intended_audience") between 1 and 1000 and "lucid"."agent_job_publishing_preferences"."intended_audience" = btrim("lucid"."agent_job_publishing_preferences"."intended_audience"))),
	CONSTRAINT "agent_job_publishing_preferences_tone_valid" CHECK ("lucid"."agent_job_publishing_preferences"."tone" is null or (char_length("lucid"."agent_job_publishing_preferences"."tone") between 1 and 1000 and "lucid"."agent_job_publishing_preferences"."tone" = btrim("lucid"."agent_job_publishing_preferences"."tone"))),
	CONSTRAINT "agent_job_publishing_preferences_source_guidance_valid" CHECK ("lucid"."agent_job_publishing_preferences"."source_guidance" is null or (char_length("lucid"."agent_job_publishing_preferences"."source_guidance") between 1 and 4000 and "lucid"."agent_job_publishing_preferences"."source_guidance" = btrim("lucid"."agent_job_publishing_preferences"."source_guidance")))
);
--> statement-breakpoint
CREATE TABLE "lucid"."agent_job_publishing_topics" (
	"agent_job_id" text NOT NULL,
	"position" integer NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "agent_job_publishing_topics_pk" PRIMARY KEY("agent_job_id","topic"),
	CONSTRAINT "agent_job_publishing_topics_position_nonnegative" CHECK ("lucid"."agent_job_publishing_topics"."position" >= 0),
	CONSTRAINT "agent_job_publishing_topics_topic_valid" CHECK (char_length("lucid"."agent_job_publishing_topics"."topic") between 1 and 120 and "lucid"."agent_job_publishing_topics"."topic" = btrim("lucid"."agent_job_publishing_topics"."topic"))
);
--> statement-breakpoint
CREATE TABLE "lucid"."agent_job_run_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_job_id" text NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"current_execution_id" text,
	"outcome_summary" text,
	"requested_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "agent_job_run_requests_state_valid" CHECK ("lucid"."agent_job_run_requests"."state" in ('requested', 'claimed', 'settled')),
	CONSTRAINT "agent_job_run_requests_outcome_valid" CHECK ("lucid"."agent_job_run_requests"."outcome" is null or "lucid"."agent_job_run_requests"."outcome" in ('published', 'no-post', 'failed')),
	CONSTRAINT "agent_job_run_requests_lifecycle_valid" CHECK ((
        "lucid"."agent_job_run_requests"."state" = 'requested'
        and "lucid"."agent_job_run_requests"."current_execution_id" is null
        and "lucid"."agent_job_run_requests"."claimed_at" is null
        and "lucid"."agent_job_run_requests"."outcome" is null
        and "lucid"."agent_job_run_requests"."outcome_summary" is null
        and "lucid"."agent_job_run_requests"."settled_at" is null
      ) or (
        "lucid"."agent_job_run_requests"."state" = 'claimed'
        and "lucid"."agent_job_run_requests"."current_execution_id" is not null
        and "lucid"."agent_job_run_requests"."claimed_at" is not null
        and "lucid"."agent_job_run_requests"."outcome" is null
        and "lucid"."agent_job_run_requests"."outcome_summary" is null
        and "lucid"."agent_job_run_requests"."settled_at" is null
      ) or (
        "lucid"."agent_job_run_requests"."state" = 'settled'
        and "lucid"."agent_job_run_requests"."current_execution_id" is not null
        and "lucid"."agent_job_run_requests"."claimed_at" is not null
        and "lucid"."agent_job_run_requests"."outcome" is not null
        and "lucid"."agent_job_run_requests"."settled_at" is not null
      )),
	CONSTRAINT "agent_job_run_requests_outcome_summary_valid" CHECK ("lucid"."agent_job_run_requests"."outcome_summary" is null or (char_length("lucid"."agent_job_run_requests"."outcome_summary") between 1 and 2000 and "lucid"."agent_job_run_requests"."outcome_summary" = btrim("lucid"."agent_job_run_requests"."outcome_summary")))
);
--> statement-breakpoint
CREATE TABLE "lucid"."agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"cadence_ms" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_jobs_kind_valid" CHECK ("lucid"."agent_jobs"."kind" in ('interest-discovery', 'information-network-publishing')),
	CONSTRAINT "agent_jobs_name_valid" CHECK (char_length("lucid"."agent_jobs"."name") between 1 and 120 and "lucid"."agent_jobs"."name" = btrim("lucid"."agent_jobs"."name")),
	CONSTRAINT "agent_jobs_instructions_valid" CHECK (char_length("lucid"."agent_jobs"."instructions") between 1 and 12000 and "lucid"."agent_jobs"."instructions" = btrim("lucid"."agent_jobs"."instructions")),
	CONSTRAINT "agent_jobs_cadence_positive" CHECK ("lucid"."agent_jobs"."cadence_ms" > 0),
	CONSTRAINT "agent_jobs_schedule_mode_valid" CHECK ("lucid"."agent_jobs"."schedule_mode" in ('manual', 'scheduled'))
);
--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD COLUMN "active_job_id" text;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD COLUMN "created_by_agent_job_id" text;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD COLUMN "created_by_agent_job_run_request_id" text;--> statement-breakpoint
ALTER TABLE "lucid"."agent_job_publishing_preferences" ADD CONSTRAINT "agent_job_publishing_preferences_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "lucid"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agent_job_publishing_topics" ADD CONSTRAINT "agent_job_publishing_topics_agent_job_id_agent_job_publishing_preferences_agent_job_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "lucid"."agent_job_publishing_preferences"("agent_job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agent_job_run_requests" ADD CONSTRAINT "agent_job_run_requests_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "lucid"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agent_jobs" ADD CONSTRAINT "agent_jobs_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agent_jobs" ADD CONSTRAINT "agent_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "lucid"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing Interest tasks use the Agent ID as their task-key suffix. Reusing
-- that value as the initial job ID preserves every deployed Heddle task ID.
INSERT INTO "lucid"."agent_jobs" (
	"id",
	"workspace_id",
	"agent_id",
	"kind",
	"name",
	"instructions",
	"cadence_ms",
	"enabled",
	"schedule_mode",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"workspace_id",
	"id",
	'interest-discovery',
	'Interest discovery',
	coalesce(
		nullif(btrim("purpose"), ''),
		nullif(btrim("instructions"), ''),
		'Review new Lucid Network activity against the owner''s current Interest.'
	),
	10800000,
	true,
	'scheduled',
	"created_at",
	"updated_at"
FROM "lucid"."agents";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_publishing_topics_position_idx" ON "lucid"."agent_job_publishing_topics" USING btree ("agent_job_id","position");--> statement-breakpoint
CREATE INDEX "agent_job_run_requests_history_idx" ON "lucid"."agent_job_run_requests" USING btree ("agent_job_id","requested_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_run_requests_active_idx" ON "lucid"."agent_job_run_requests" USING btree ("agent_job_id") WHERE "lucid"."agent_job_run_requests"."state" in ('requested', 'claimed');--> statement-breakpoint
CREATE INDEX "agent_jobs_workspace_idx" ON "lucid"."agent_jobs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "agent_jobs_agent_idx" ON "lucid"."agent_jobs" USING btree ("agent_id","id");--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_active_job_id_agent_jobs_id_fk" FOREIGN KEY ("active_job_id") REFERENCES "lucid"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD CONSTRAINT "network_posts_created_by_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("created_by_agent_job_id") REFERENCES "lucid"."agent_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD CONSTRAINT "network_posts_created_by_agent_job_run_request_id_agent_job_run_requests_id_fk" FOREIGN KEY ("created_by_agent_job_run_request_id") REFERENCES "lucid"."agent_job_run_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "network_posts_agent_job_run_request_idx" ON "lucid"."network_posts" USING btree ("created_by_agent_job_run_request_id");--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_active_job_requires_wake" CHECK ("lucid"."agents"."active_job_id" is null or "lucid"."agents"."active_wake_id" is not null);
