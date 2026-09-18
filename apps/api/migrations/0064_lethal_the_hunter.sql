CREATE TABLE "operator_poll_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(64) NOT NULL,
	"source" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'NEW' NOT NULL,
	"editorial_candidate_id" varchar(32),
	"imported_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_poll_candidates_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "operator_poll_candidates_status_check" CHECK ("operator_poll_candidates"."status" in ('NEW', 'REVIEW', 'DISMISSED')),
	CONSTRAINT "operator_poll_candidates_handoff_check" CHECK (("operator_poll_candidates"."status" = 'REVIEW') = ("operator_poll_candidates"."editorial_candidate_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "operator_editorial_candidates" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "operator_poll_candidates" ADD CONSTRAINT "operator_poll_candidates_imported_by_member_id_members_member_id_fk" FOREIGN KEY ("imported_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;