CREATE TABLE "operator_editorial_decisions" (
	"operator_editorial_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" varchar(128) NOT NULL,
	"candidate_id" varchar(32) NOT NULL,
	"status" varchar(24) NOT NULL,
	"note" varchar(2000) DEFAULT '' NOT NULL,
	"reviewed_by_member_id" uuid NOT NULL,
	"binary_fit" boolean DEFAULT false NOT NULL,
	"choice_parity" boolean DEFAULT false NOT NULL,
	"duplicate_review" boolean DEFAULT false NOT NULL,
	"source_review" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_editorial_decisions_catalog_candidate_unique" UNIQUE("catalog_id","candidate_id"),
	CONSTRAINT "operator_editorial_decisions_status_check" CHECK ("operator_editorial_decisions"."status" in ('APPROVED', 'NEEDS_CHANGES', 'REJECTED')),
	CONSTRAINT "operator_editorial_decisions_revision_check" CHECK ("operator_editorial_decisions"."revision" > 0),
	CONSTRAINT "operator_editorial_decisions_approved_checks_check" CHECK ("operator_editorial_decisions"."status" <> 'APPROVED' or (
        "operator_editorial_decisions"."binary_fit" and "operator_editorial_decisions"."choice_parity" and "operator_editorial_decisions"."duplicate_review" and "operator_editorial_decisions"."source_review"
      ))
);
--> statement-breakpoint
ALTER TABLE "operator_editorial_decisions" ADD CONSTRAINT "operator_editorial_decisions_reviewed_by_member_id_members_member_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_editorial_decisions_status_updated_idx" ON "operator_editorial_decisions" USING btree ("status","updated_at");