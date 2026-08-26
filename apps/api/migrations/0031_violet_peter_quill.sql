CREATE TABLE "issue_media_review_decisions" (
	"issue_media_review_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(16) NOT NULL,
	"media_asset_id" uuid,
	"issue_id" uuid,
	"status" varchar(24) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"rationale" text NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"reviewed_by_member_id" uuid NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_review_scope_check" CHECK ("issue_media_review_decisions"."scope" in ('ASSET', 'ISSUE')),
	CONSTRAINT "issue_media_review_target_check" CHECK (("issue_media_review_decisions"."scope" = 'ASSET' and "issue_media_review_decisions"."media_asset_id" is not null and "issue_media_review_decisions"."issue_id" is null)
        or ("issue_media_review_decisions"."scope" = 'ISSUE' and "issue_media_review_decisions"."issue_id" is not null and "issue_media_review_decisions"."media_asset_id" is null)),
	CONSTRAINT "issue_media_review_status_check" CHECK ("issue_media_review_decisions"."status" in ('APPROVED', 'REJECTED', 'HIDDEN', 'RESTORED', 'DELETED')),
	CONSTRAINT "issue_media_review_rationale_check" CHECK (char_length("issue_media_review_decisions"."rationale") between 10 and 2000)
);
--> statement-breakpoint
CREATE TABLE "issue_media_rights_requests" (
	"issue_media_rights_request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" varchar(24) NOT NULL,
	"media_asset_id" uuid,
	"issue_id" uuid,
	"requester_reference" varchar(300) NOT NULL,
	"details" text NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"action_decision_id" uuid,
	"recorded_by_member_id" uuid NOT NULL,
	"resolved_by_member_id" uuid,
	"request_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_rights_type_check" CHECK ("issue_media_rights_requests"."request_type" in ('PRIVACY', 'DEFAMATION', 'COPYRIGHT')),
	CONSTRAINT "issue_media_rights_target_check" CHECK ("issue_media_rights_requests"."media_asset_id" is not null or "issue_media_rights_requests"."issue_id" is not null),
	CONSTRAINT "issue_media_rights_status_check" CHECK ("issue_media_rights_requests"."status" in ('OPEN', 'ACTIONED', 'DISMISSED')),
	CONSTRAINT "issue_media_rights_details_check" CHECK (char_length("issue_media_rights_requests"."details") between 10 and 4000),
	CONSTRAINT "issue_media_rights_resolution_check" CHECK (("issue_media_rights_requests"."status" = 'OPEN' and "issue_media_rights_requests"."resolved_at" is null and "issue_media_rights_requests"."resolved_by_member_id" is null)
        or ("issue_media_rights_requests"."status" <> 'OPEN' and "issue_media_rights_requests"."resolved_at" is not null and "issue_media_rights_requests"."resolved_by_member_id" is not null and char_length("issue_media_rights_requests"."resolution") between 10 and 4000))
);
--> statement-breakpoint
ALTER TABLE "issue_media_review_decisions" ADD CONSTRAINT "issue_media_review_decisions_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_review_decisions" ADD CONSTRAINT "issue_media_review_decisions_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_review_decisions" ADD CONSTRAINT "issue_media_review_decisions_reviewed_by_member_id_members_member_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rights_requests" ADD CONSTRAINT "issue_media_rights_requests_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rights_requests" ADD CONSTRAINT "issue_media_rights_requests_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rights_requests" ADD CONSTRAINT "issue_media_rights_requests_action_decision_id_issue_media_review_decisions_issue_media_review_decision_id_fk" FOREIGN KEY ("action_decision_id") REFERENCES "public"."issue_media_review_decisions"("issue_media_review_decision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rights_requests" ADD CONSTRAINT "issue_media_rights_requests_recorded_by_member_id_members_member_id_fk" FOREIGN KEY ("recorded_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rights_requests" ADD CONSTRAINT "issue_media_rights_requests_resolved_by_member_id_members_member_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_media_review_asset_created_idx" ON "issue_media_review_decisions" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_review_issue_created_idx" ON "issue_media_review_decisions" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_rights_status_created_idx" ON "issue_media_rights_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_rights_asset_idx" ON "issue_media_rights_requests" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_rights_issue_idx" ON "issue_media_rights_requests" USING btree ("issue_id","created_at");