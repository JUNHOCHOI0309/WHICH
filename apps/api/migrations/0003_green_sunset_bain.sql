CREATE TABLE "comment_write_attempts" (
	"comment_write_attempt_id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_snapshot" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "text_policy_version" varchar(32) DEFAULT 'comment-text-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_write_attempts" ADD CONSTRAINT "comment_write_attempts_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_write_attempts" ADD CONSTRAINT "comment_write_attempts_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_write_attempts_member_received_idx" ON "comment_write_attempts" USING btree ("member_id","received_at");--> statement-breakpoint
CREATE INDEX "comment_write_attempts_issue_received_idx" ON "comment_write_attempts" USING btree ("issue_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_one_active_top_level_per_issue_author_unique" ON "comments" USING btree ("issue_id","author_subject_id") WHERE "comments"."parent_comment_id" is null and "comments"."deleted_at" is null;