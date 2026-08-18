CREATE TYPE "public"."comment_moderation_action" AS ENUM('COLLAPSE', 'HIDE', 'REMOVE_POLICY', 'RESTORE');--> statement-breakpoint
CREATE TYPE "public"."comment_moderation_source" AS ENUM('SYSTEM_AUTOMATION', 'INTERNAL_MODERATOR');--> statement-breakpoint
CREATE TYPE "public"."comment_report_reason" AS ENUM('SPAM', 'HARASSMENT', 'HATE_OR_ABUSE', 'PERSONAL_INFORMATION', 'OTHER');--> statement-breakpoint
CREATE TABLE "comment_moderation_decisions" (
	"comment_moderation_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"action" "comment_moderation_action" NOT NULL,
	"source" "comment_moderation_source" NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"from_publication_state" "comment_publication_state" NOT NULL,
	"to_publication_state" "comment_publication_state" NOT NULL,
	"from_visibility" "comment_visibility" NOT NULL,
	"to_visibility" "comment_visibility" NOT NULL,
	"from_integrity_state" "comment_integrity_state" NOT NULL,
	"to_integrity_state" "comment_integrity_state" NOT NULL,
	"evidence" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_moderation_decisions_comment_revision_unique" UNIQUE("comment_id","revision"),
	CONSTRAINT "comment_moderation_decisions_revision_check" CHECK ("comment_moderation_decisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "comment_report_attempts" (
	"comment_report_attempt_id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"actor_subject_id" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_snapshot" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"comment_report_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"origin_subject_id" uuid NOT NULL,
	"reason" "comment_report_reason" NOT NULL,
	"detail" text,
	"weight" integer NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"merged_into_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reports_comment_subject_unique" UNIQUE("comment_id","subject_id"),
	CONSTRAINT "comment_reports_weight_check" CHECK ("comment_reports"."weight" in (1, 2)),
	CONSTRAINT "comment_reports_merge_shape_check" CHECK (("comment_reports"."counted" = true and "comment_reports"."merged_into_report_id" is null)
        or ("comment_reports"."counted" = false and "comment_reports"."merged_into_report_id" is not null)),
	CONSTRAINT "comment_reports_not_self_merged_check" CHECK ("comment_reports"."merged_into_report_id" is null or "comment_reports"."merged_into_report_id" <> "comment_reports"."comment_report_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "report_score_baseline" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "reporter_count_baseline" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_moderation_decisions" ADD CONSTRAINT "comment_moderation_decisions_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_report_attempts" ADD CONSTRAINT "comment_report_attempts_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_report_attempts" ADD CONSTRAINT "comment_report_attempts_actor_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("actor_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_origin_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("origin_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_merged_into_fk" FOREIGN KEY ("merged_into_report_id") REFERENCES "public"."comment_reports"("comment_report_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_moderation_decisions_comment_decided_idx" ON "comment_moderation_decisions" USING btree ("comment_id","decided_at");--> statement-breakpoint
CREATE INDEX "comment_report_attempts_actor_received_idx" ON "comment_report_attempts" USING btree ("actor_subject_id","received_at");--> statement-breakpoint
CREATE INDEX "comment_reports_counted_comment_idx" ON "comment_reports" USING btree ("comment_id","created_at") WHERE "comment_reports"."counted" = true;--> statement-breakpoint
CREATE INDEX "comment_reports_subject_created_idx" ON "comment_reports" USING btree ("subject_id","created_at");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_report_score_baseline_check" CHECK ("comments"."report_score_baseline" >= 0);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reporter_count_baseline_check" CHECK ("comments"."reporter_count_baseline" >= 0);