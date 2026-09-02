CREATE TABLE "lucid"."finding_posts" (
	"finding_sequence" bigint NOT NULL,
	"post_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "finding_posts_pk" PRIMARY KEY("finding_sequence","post_id"),
	CONSTRAINT "finding_posts_position_nonnegative" CHECK ("lucid"."finding_posts"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lucid"."network_post_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"source_name" text NOT NULL,
	"url" text NOT NULL,
	"retrieved_at" timestamp with time zone,
	CONSTRAINT "network_post_sources_position_nonnegative" CHECK ("lucid"."network_post_sources"."position" >= 0),
	CONSTRAINT "network_post_sources_title_valid" CHECK (char_length("lucid"."network_post_sources"."title") between 1 and 500 and "lucid"."network_post_sources"."title" = btrim("lucid"."network_post_sources"."title")),
	CONSTRAINT "network_post_sources_name_valid" CHECK (char_length("lucid"."network_post_sources"."source_name") between 1 and 200 and "lucid"."network_post_sources"."source_name" = btrim("lucid"."network_post_sources"."source_name")),
	CONSTRAINT "network_post_sources_url_valid" CHECK (char_length("lucid"."network_post_sources"."url") between 1 and 2048 and "lucid"."network_post_sources"."url" = btrim("lucid"."network_post_sources"."url"))
);
--> statement-breakpoint
CREATE TABLE "lucid"."network_post_topics" (
	"post_id" text NOT NULL,
	"position" integer NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "network_post_topics_pk" PRIMARY KEY("post_id","topic"),
	CONSTRAINT "network_post_topics_position_nonnegative" CHECK ("lucid"."network_post_topics"."position" >= 0),
	CONSTRAINT "network_post_topics_topic_valid" CHECK (char_length("lucid"."network_post_topics"."topic") between 1 and 120 and "lucid"."network_post_topics"."topic" = btrim("lucid"."network_post_topics"."topic"))
);
--> statement-breakpoint
CREATE TABLE "lucid"."network_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"author_profile_id" text NOT NULL,
	"author_agent_id" text,
	"publication_method" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_execution_id" text,
	"idempotency_key" text,
	CONSTRAINT "network_posts_publication_method_valid" CHECK ("lucid"."network_posts"."publication_method" in ('seeded-pilot', 'agent')),
	CONSTRAINT "network_posts_publication_provenance_valid" CHECK ((
        "lucid"."network_posts"."publication_method" = 'agent'
        and "lucid"."network_posts"."author_agent_id" is not null
        and "lucid"."network_posts"."created_by_execution_id" is not null
      ) or (
        "lucid"."network_posts"."publication_method" = 'seeded-pilot'
        and "lucid"."network_posts"."author_agent_id" is null
        and "lucid"."network_posts"."created_by_execution_id" is null
      )),
	CONSTRAINT "network_posts_title_valid" CHECK (char_length("lucid"."network_posts"."title") between 1 and 240 and "lucid"."network_posts"."title" = btrim("lucid"."network_posts"."title")),
	CONSTRAINT "network_posts_body_valid" CHECK (char_length("lucid"."network_posts"."body") between 1 and 20000 and "lucid"."network_posts"."body" = btrim("lucid"."network_posts"."body"))
);
--> statement-breakpoint
CREATE TABLE "lucid"."network_profile_topics" (
	"profile_id" text NOT NULL,
	"position" integer NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "network_profile_topics_pk" PRIMARY KEY("profile_id","topic"),
	CONSTRAINT "network_profile_topics_position_nonnegative" CHECK ("lucid"."network_profile_topics"."position" >= 0),
	CONSTRAINT "network_profile_topics_topic_valid" CHECK (char_length("lucid"."network_profile_topics"."topic") between 1 and 120 and "lucid"."network_profile_topics"."topic" = btrim("lucid"."network_profile_topics"."topic"))
);
--> statement-breakpoint
CREATE TABLE "lucid"."network_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"public_description" text NOT NULL,
	"publishing_focus" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "network_profiles_description_valid" CHECK (char_length("lucid"."network_profiles"."public_description") between 1 and 2000 and "lucid"."network_profiles"."public_description" = btrim("lucid"."network_profiles"."public_description")),
	CONSTRAINT "network_profiles_focus_valid" CHECK (char_length("lucid"."network_profiles"."publishing_focus") between 1 and 120 and "lucid"."network_profiles"."publishing_focus" = btrim("lucid"."network_profiles"."publishing_focus"))
);
--> statement-breakpoint
ALTER TABLE "lucid"."finding_posts" ADD CONSTRAINT "finding_posts_finding_sequence_discovery_events_sequence_fk" FOREIGN KEY ("finding_sequence") REFERENCES "lucid"."discovery_events"("sequence") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."finding_posts" ADD CONSTRAINT "finding_posts_post_id_network_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "lucid"."network_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_post_sources" ADD CONSTRAINT "network_post_sources_post_id_network_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "lucid"."network_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_post_topics" ADD CONSTRAINT "network_post_topics_post_id_network_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "lucid"."network_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD CONSTRAINT "network_posts_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD CONSTRAINT "network_posts_author_profile_id_network_profiles_id_fk" FOREIGN KEY ("author_profile_id") REFERENCES "lucid"."network_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_posts" ADD CONSTRAINT "network_posts_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "lucid"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_profile_topics" ADD CONSTRAINT "network_profile_topics_profile_id_network_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "lucid"."network_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_profiles" ADD CONSTRAINT "network_profiles_workspace_id_discovery_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "lucid"."discovery_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lucid"."network_profiles" ADD CONSTRAINT "network_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "lucid"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_posts_position_idx" ON "lucid"."finding_posts" USING btree ("finding_sequence","position");--> statement-breakpoint
CREATE INDEX "finding_posts_post_idx" ON "lucid"."finding_posts" USING btree ("post_id","finding_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "network_post_sources_position_idx" ON "lucid"."network_post_sources" USING btree ("post_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "network_post_sources_url_idx" ON "lucid"."network_post_sources" USING btree ("post_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "network_post_topics_position_idx" ON "lucid"."network_post_topics" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "network_post_topics_topic_idx" ON "lucid"."network_post_topics" USING btree ("topic","post_id");--> statement-breakpoint
CREATE INDEX "network_posts_feed_idx" ON "lucid"."network_posts" USING btree ("workspace_id","published_at","id");--> statement-breakpoint
CREATE INDEX "network_posts_profile_idx" ON "lucid"."network_posts" USING btree ("author_profile_id","published_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_posts_idempotency_idx" ON "lucid"."network_posts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "network_profile_topics_position_idx" ON "lucid"."network_profile_topics" USING btree ("profile_id","position");--> statement-breakpoint
CREATE INDEX "network_profile_topics_topic_idx" ON "lucid"."network_profile_topics" USING btree ("topic","profile_id");--> statement-breakpoint
CREATE INDEX "network_profiles_workspace_idx" ON "lucid"."network_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_profiles_user_idx" ON "lucid"."network_profiles" USING btree ("user_id");
