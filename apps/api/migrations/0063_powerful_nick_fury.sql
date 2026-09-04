CREATE TABLE "operator_editorial_candidates" (
	"operator_editorial_candidate_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" varchar(128) NOT NULL,
	"candidate_id" varchar(32) NOT NULL,
	"question" varchar(200) NOT NULL,
	"context" varchar(500) NOT NULL,
	"choices" jsonb NOT NULL,
	"category_code" varchar(64) NOT NULL,
	"interest_card_code" varchar(64) NOT NULL,
	"editorial_area" varchar(64) NOT NULL,
	"inventory_scope" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_editorial_candidates_catalog_candidate_unique" UNIQUE("catalog_id","candidate_id"),
	CONSTRAINT "operator_editorial_candidates_inventory_scope_check" CHECK ("operator_editorial_candidates"."inventory_scope" in ('ACTIVE', 'RESERVE', 'LONG_TERM')),
	CONSTRAINT "operator_editorial_candidates_content_hash_check" CHECK ("operator_editorial_candidates"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "operator_editorial_candidates" ADD CONSTRAINT "operator_editorial_candidates_created_by_member_id_members_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_editorial_candidates_created_idx" ON "operator_editorial_candidates" USING btree ("created_at","candidate_id");