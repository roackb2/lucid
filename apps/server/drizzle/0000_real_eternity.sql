CREATE TABLE "lucid_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"task" text NOT NULL,
	"heartbeat_task_id" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
