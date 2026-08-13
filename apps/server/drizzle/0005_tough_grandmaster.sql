CREATE TABLE "lucid"."hosted_conversation_turns" (
	"invocation_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text NOT NULL,
	"run_id" text,
	"answer_markdown" text,
	"error_code" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hosted_conversation_turns_invocation_id_valid" CHECK (char_length("lucid"."hosted_conversation_turns"."invocation_id") between 1 and 256),
	CONSTRAINT "hosted_conversation_turns_prompt_valid" CHECK (char_length("lucid"."hosted_conversation_turns"."prompt") between 1 and 20000 and "lucid"."hosted_conversation_turns"."prompt" = btrim("lucid"."hosted_conversation_turns"."prompt")),
	CONSTRAINT "hosted_conversation_turns_status_valid" CHECK ("lucid"."hosted_conversation_turns"."status" in ('requested', 'running', 'completed', 'max_steps', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "hosted_conversation_turns_run_id_valid" CHECK ("lucid"."hosted_conversation_turns"."run_id" is null or char_length("lucid"."hosted_conversation_turns"."run_id") between 1 and 256),
	CONSTRAINT "hosted_conversation_turns_answer_bounded" CHECK ("lucid"."hosted_conversation_turns"."answer_markdown" is null or char_length("lucid"."hosted_conversation_turns"."answer_markdown") <= 100000),
	CONSTRAINT "hosted_conversation_turns_error_code_valid" CHECK ("lucid"."hosted_conversation_turns"."error_code" is null or "lucid"."hosted_conversation_turns"."error_code" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
	CONSTRAINT "hosted_conversation_turns_lifecycle_valid" CHECK ((
        "lucid"."hosted_conversation_turns"."status" = 'requested'
        and "lucid"."hosted_conversation_turns"."run_id" is null
        and "lucid"."hosted_conversation_turns"."accepted_at" is null
        and "lucid"."hosted_conversation_turns"."settled_at" is null
      ) or (
        "lucid"."hosted_conversation_turns"."status" = 'running'
        and "lucid"."hosted_conversation_turns"."run_id" is not null
        and "lucid"."hosted_conversation_turns"."accepted_at" is not null
        and "lucid"."hosted_conversation_turns"."settled_at" is null
      ) or (
        "lucid"."hosted_conversation_turns"."status" in ('completed', 'max_steps', 'failed', 'cancelled', 'interrupted')
        and "lucid"."hosted_conversation_turns"."settled_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "lucid"."hosted_conversation_turns" ADD CONSTRAINT "hosted_conversation_turns_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."hosted_conversation_turns" ADD CONSTRAINT "hosted_conversation_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "lucid"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hosted_conversation_turns_user_recent_idx" ON "lucid"."hosted_conversation_turns" USING btree ("workspace_id","user_id","created_at");