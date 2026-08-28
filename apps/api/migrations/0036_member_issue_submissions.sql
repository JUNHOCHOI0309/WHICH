CREATE TABLE "member_issue_submissions" (
	"submission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"question" text NOT NULL,
	"context" text,
	"choice_a" text NOT NULL,
	"choice_b" text NOT NULL,
	"media_asset_a_id" uuid,
	"media_asset_b_id" uuid,
	"interest_card_code" varchar(64) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"review_note" varchar(2000),
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_issue_submissions_member_idempotency_unique" UNIQUE("member_id","idempotency_key"),
	CONSTRAINT "member_issue_submissions_revision_check" CHECK ("member_issue_submissions"."revision" > 0),
	CONSTRAINT "member_issue_submissions_status_check" CHECK ("member_issue_submissions"."status" in ('PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_media_asset_a_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_a_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_media_asset_b_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_b_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_issue_submissions_member_updated_idx" ON "member_issue_submissions" USING btree ("member_id","updated_at");
--> statement-breakpoint
CREATE INDEX "member_issue_submissions_status_submitted_idx" ON "member_issue_submissions" USING btree ("status","submitted_at");
--> statement-breakpoint
CREATE TABLE "member_issue_submission_revisions" (
	"submission_revision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"question" text NOT NULL,
	"context" text,
	"choice_a" text NOT NULL,
	"choice_b" text NOT NULL,
	"media_asset_a_id" uuid,
	"media_asset_b_id" uuid,
	"interest_card_code" varchar(64) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_issue_submission_revisions_submission_revision_unique" UNIQUE("submission_id","revision"),
	CONSTRAINT "member_issue_submission_revisions_member_idempotency_unique" UNIQUE("member_id","idempotency_key"),
	CONSTRAINT "member_issue_submission_revisions_revision_check" CHECK ("member_issue_submission_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_submission_id_member_issue_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."member_issue_submissions"("submission_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_media_asset_a_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_a_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_media_asset_b_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_b_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_issue_submission_revisions_submission_idx" ON "member_issue_submission_revisions" USING btree ("submission_id","revision");
--> statement-breakpoint
ALTER TABLE "issue_media_assets" DROP CONSTRAINT "issue_media_assets_source_type_check";
--> statement-breakpoint
ALTER TABLE "issue_media_assets" ADD CONSTRAINT "issue_media_assets_source_type_check" CHECK ("issue_media_assets"."source_type" in ('OPERATOR_UPLOAD', 'MEMBER_SUBMISSION'));
