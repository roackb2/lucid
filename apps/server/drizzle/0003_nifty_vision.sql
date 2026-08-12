CREATE TABLE "lucid"."participant_identity_bindings" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"participant_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participant_identity_bindings_pk" PRIMARY KEY("issuer","subject"),
	CONSTRAINT "participant_identity_bindings_issuer_valid" CHECK (char_length("lucid"."participant_identity_bindings"."issuer") between 1 and 512 and "lucid"."participant_identity_bindings"."issuer" = btrim("lucid"."participant_identity_bindings"."issuer")),
	CONSTRAINT "participant_identity_bindings_subject_valid" CHECK (char_length("lucid"."participant_identity_bindings"."subject") between 1 and 512 and "lucid"."participant_identity_bindings"."subject" = btrim("lucid"."participant_identity_bindings"."subject"))
);
--> statement-breakpoint
ALTER TABLE "lucid"."participant_identity_bindings" ADD CONSTRAINT "participant_identity_bindings_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "lucid"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_identity_bindings_participant_idx" ON "lucid"."participant_identity_bindings" USING btree ("participant_id");