ALTER TABLE "lucid"."representative_agents" RENAME TO "agents";--> statement-breakpoint
ALTER TABLE "lucid"."participant_identity_bindings" RENAME TO "user_identity_bindings";--> statement-breakpoint
ALTER TABLE "lucid"."participants" RENAME TO "users";--> statement-breakpoint
ALTER TABLE "lucid"."discovery_events" RENAME COLUMN "target_participant_id" TO "target_user_id";--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" RENAME COLUMN "participant_id" TO "user_id";--> statement-breakpoint
ALTER TABLE "lucid"."agents" RENAME COLUMN "participant_id" TO "user_id";--> statement-breakpoint
UPDATE "lucid"."discovery_events"
SET "kind" = CASE "kind"
  WHEN 'participant_input' THEN 'user_input'
  WHEN 'representative_note_updated' THEN 'agent_note_updated'
  WHEN 'participant_added' THEN 'user_added'
  WHEN 'participant_disabled' THEN 'user_disabled'
  WHEN 'participant_enabled' THEN 'user_enabled'
  WHEN 'participant_retired' THEN 'user_retired'
  ELSE "kind"
END
WHERE "kind" IN (
  'participant_input',
  'representative_note_updated',
  'participant_added',
  'participant_disabled',
  'participant_enabled',
  'participant_retired'
);--> statement-breakpoint
UPDATE "lucid"."discovery_events"
SET "metadata" = (
  "metadata" - 'participantId' - 'participantKind'
) || CASE
  WHEN "metadata" ? 'participantId'
    THEN jsonb_build_object('userId', "metadata" -> 'participantId')
  ELSE '{}'::jsonb
END || CASE
  WHEN "metadata" ? 'participantKind'
    THEN jsonb_build_object('userKind', "metadata" -> 'participantKind')
  ELSE '{}'::jsonb
END
WHERE "metadata" ?| ARRAY['participantId', 'participantKind'];--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" DROP CONSTRAINT "participant_identity_bindings_issuer_valid";--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" DROP CONSTRAINT "participant_identity_bindings_subject_valid";--> statement-breakpoint
ALTER TABLE "lucid"."users" DROP CONSTRAINT "participants_kind_valid";--> statement-breakpoint
ALTER TABLE "lucid"."users" DROP CONSTRAINT "participants_status_valid";--> statement-breakpoint
ALTER TABLE "lucid"."users" DROP CONSTRAINT "participants_human_consent_required";--> statement-breakpoint
ALTER TABLE "lucid"."agents" DROP CONSTRAINT "representative_agents_status_valid";--> statement-breakpoint
ALTER TABLE "lucid"."agents" DROP CONSTRAINT "representative_agents_counters_nonnegative";--> statement-breakpoint
ALTER TABLE "lucid"."agents" DROP CONSTRAINT "representative_agents_wake_claim_complete";--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" DROP CONSTRAINT "participant_identity_bindings_participant_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "lucid"."users" DROP CONSTRAINT "participants_workspace_id_discovery_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "lucid"."agents" DROP CONSTRAINT "representative_agents_workspace_id_discovery_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "lucid"."agents" DROP CONSTRAINT "representative_agents_participant_id_participants_id_fk";
--> statement-breakpoint
DROP INDEX "lucid"."discovery_events_target_participant_idx";--> statement-breakpoint
DROP INDEX "lucid"."participant_identity_bindings_participant_idx";--> statement-breakpoint
DROP INDEX "lucid"."participants_workspace_idx";--> statement-breakpoint
DROP INDEX "lucid"."participants_registration_key_idx";--> statement-breakpoint
DROP INDEX "lucid"."representative_agents_workspace_sort_idx";--> statement-breakpoint
DROP INDEX "lucid"."representative_agents_participant_idx";--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" DROP CONSTRAINT "participant_identity_bindings_pk";--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" ADD CONSTRAINT "user_identity_bindings_pk" PRIMARY KEY("issuer","subject");--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" ADD CONSTRAINT "user_identity_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "lucid"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."users" ADD CONSTRAINT "users_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "lucid"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_events_target_user_idx" ON "lucid"."discovery_events" USING btree ("target_user_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_bindings_user_idx" ON "lucid"."user_identity_bindings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_workspace_idx" ON "lucid"."users" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_registration_key_idx" ON "lucid"."users" USING btree ("registration_key");--> statement-breakpoint
CREATE INDEX "agents_workspace_sort_idx" ON "lucid"."agents" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_idx" ON "lucid"."agents" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" ADD CONSTRAINT "user_identity_bindings_issuer_valid" CHECK (char_length("lucid"."user_identity_bindings"."issuer") between 1 and 512 and "lucid"."user_identity_bindings"."issuer" = btrim("lucid"."user_identity_bindings"."issuer"));--> statement-breakpoint
ALTER TABLE "lucid"."user_identity_bindings" ADD CONSTRAINT "user_identity_bindings_subject_valid" CHECK (char_length("lucid"."user_identity_bindings"."subject") between 1 and 512 and "lucid"."user_identity_bindings"."subject" = btrim("lucid"."user_identity_bindings"."subject"));--> statement-breakpoint
ALTER TABLE "lucid"."users" ADD CONSTRAINT "users_kind_valid" CHECK ("lucid"."users"."kind" in ('human', 'synthetic'));--> statement-breakpoint
ALTER TABLE "lucid"."users" ADD CONSTRAINT "users_status_valid" CHECK ("lucid"."users"."status" in ('active', 'disabled', 'retired'));--> statement-breakpoint
ALTER TABLE "lucid"."users" ADD CONSTRAINT "users_human_consent_required" CHECK ("lucid"."users"."kind" <> 'human' or "lucid"."users"."context_consent_at" is not null);--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_status_valid" CHECK ("lucid"."agents"."status" in ('idle', 'running', 'error'));--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_counters_nonnegative" CHECK ("lucid"."agents"."sort_order" >= 0 and "lucid"."agents"."run_count" >= 0 and "lucid"."agents"."mailbox_floor_sequence" >= 0 and "lucid"."agents"."last_seen_sequence" >= 0);--> statement-breakpoint
ALTER TABLE "lucid"."agents" ADD CONSTRAINT "agents_wake_claim_complete" CHECK ((
        "lucid"."agents"."active_wake_id" is null
        and "lucid"."agents"."active_wake_claim_token" is null
        and "lucid"."agents"."active_wake_number" is null
        and "lucid"."agents"."active_wake_horizon" is null
      ) or (
        "lucid"."agents"."active_wake_id" is not null
        and "lucid"."agents"."active_wake_claim_token" is not null
        and "lucid"."agents"."active_wake_number" is not null
        and "lucid"."agents"."active_wake_horizon" is not null
      ));
