ALTER TYPE "public"."choice_code" ADD VALUE 'C';--> statement-breakpoint
ALTER TYPE "public"."choice_code" ADD VALUE 'D';--> statement-breakpoint
CREATE TABLE "issue_context_media" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"alt_text" varchar(300) NOT NULL,
	"crop_mode" varchar(16) DEFAULT 'CONTAIN' NOT NULL,
	"linked_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_context_media_pk" PRIMARY KEY("issue_id","issue_version"),
	CONSTRAINT "issue_context_media_alt_text_check" CHECK (char_length("issue_context_media"."alt_text") between 2 and 300),
	CONSTRAINT "issue_context_media_crop_mode_check" CHECK ("issue_context_media"."crop_mode" in ('COVER', 'CONTAIN'))
);
--> statement-breakpoint
ALTER TABLE "issue_choice_media" DROP CONSTRAINT "issue_choice_media_position_check";--> statement-breakpoint
ALTER TABLE "result_snapshots" DROP CONSTRAINT "result_snapshots_counts_check";--> statement-breakpoint
ALTER TABLE "vote_aggregates" DROP CONSTRAINT "vote_aggregates_counts_check";--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD COLUMN "context_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD COLUMN "choice_c" text;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD COLUMN "choice_d" text;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD COLUMN "media_asset_c_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD COLUMN "media_asset_d_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "context_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "choice_c" text;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "choice_d" text;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "media_asset_c_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "media_asset_d_id" uuid;--> statement-breakpoint
ALTER TABLE "result_snapshots" ADD COLUMN "accepted_c_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "result_snapshots" ADD COLUMN "accepted_d_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vote_aggregates" ADD COLUMN "accepted_c_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vote_aggregates" ADD COLUMN "accepted_d_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_context_media" ADD CONSTRAINT "issue_context_media_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_context_media" ADD CONSTRAINT "issue_context_media_linked_by_member_id_members_member_id_fk" FOREIGN KEY ("linked_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_context_media" ADD CONSTRAINT "issue_context_media_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_context_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("context_media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_media_asset_c_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_c_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submission_revisions" ADD CONSTRAINT "member_issue_submission_revisions_media_asset_d_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_d_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_context_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("context_media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_media_asset_c_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_c_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_media_asset_d_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_d_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_choice_media" ADD CONSTRAINT "issue_choice_media_position_check" CHECK ("issue_choice_media"."display_position" between 0 and 3);--> statement-breakpoint
ALTER TABLE "result_snapshots" ADD CONSTRAINT "result_snapshots_counts_check" CHECK ("result_snapshots"."result_version" > 0 and "result_snapshots"."accepted_a_count" >= 0 and "result_snapshots"."accepted_b_count" >= 0 and "result_snapshots"."accepted_c_count" >= 0 and "result_snapshots"."accepted_d_count" >= 0 and "result_snapshots"."displayed_vote_count" = "result_snapshots"."accepted_a_count" + "result_snapshots"."accepted_b_count" + "result_snapshots"."accepted_c_count" + "result_snapshots"."accepted_d_count");--> statement-breakpoint
ALTER TABLE "vote_aggregates" ADD CONSTRAINT "vote_aggregates_counts_check" CHECK ("vote_aggregates"."vote_request_count" >= 0 and "vote_aggregates"."accepted_a_count" >= 0 and "vote_aggregates"."accepted_b_count" >= 0
        and "vote_aggregates"."accepted_c_count" >= 0 and "vote_aggregates"."accepted_d_count" >= 0
        and "vote_aggregates"."review_vote_count" >= 0 and "vote_aggregates"."rejected_duplicate_count" >= 0 and "vote_aggregates"."rejected_abuse_count" >= 0
        and "vote_aggregates"."invalidated_vote_count" >= 0 and "vote_aggregates"."accepted_vote_count" = "vote_aggregates"."accepted_a_count" + "vote_aggregates"."accepted_b_count" + "vote_aggregates"."accepted_c_count" + "vote_aggregates"."accepted_d_count"
        and "vote_aggregates"."displayed_vote_count" = "vote_aggregates"."accepted_vote_count");