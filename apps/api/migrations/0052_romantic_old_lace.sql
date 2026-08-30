ALTER TABLE "member_issue_submissions" DROP CONSTRAINT "member_issue_submissions_status_check";--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD COLUMN "published_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_published_issue_id_issues_issue_id_fk" FOREIGN KEY ("published_issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue_submissions" ADD CONSTRAINT "member_issue_submissions_status_check" CHECK ("member_issue_submissions"."status" in ('PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED', 'CANCELLED'));
