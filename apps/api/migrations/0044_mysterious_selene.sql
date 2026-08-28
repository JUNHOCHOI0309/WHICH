CREATE TABLE "member_moderation_notices" (
	"member_moderation_notice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"action_type" varchar(48) NOT NULL,
	"summary" text NOT NULL,
	"next_step" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_moderation_notices_target_type_check" CHECK ("member_moderation_notices"."target_type" in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')),
	CONSTRAINT "member_moderation_notices_summary_check" CHECK (char_length("member_moderation_notices"."summary") >= 2),
	CONSTRAINT "member_moderation_notices_next_step_check" CHECK (char_length("member_moderation_notices"."next_step") >= 2)
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"moderation_appeal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'SUBMITTED' NOT NULL,
	"resolution" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_appeals_target_type_check" CHECK ("moderation_appeals"."target_type" in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')),
	CONSTRAINT "moderation_appeals_status_check" CHECK ("moderation_appeals"."status" in ('SUBMITTED', 'IN_REVIEW', 'UPHELD', 'OVERTURNED', 'CANCELLED')),
	CONSTRAINT "moderation_appeals_reason_check" CHECK (char_length("moderation_appeals"."reason") between 20 and 4000),
	CONSTRAINT "moderation_appeals_resolution_check" CHECK (("moderation_appeals"."status" in ('SUBMITTED', 'IN_REVIEW', 'CANCELLED')) or ("moderation_appeals"."resolved_at" is not null and char_length("moderation_appeals"."resolution") between 10 and 4000))
);
--> statement-breakpoint
CREATE TABLE "moderation_rights_cases" (
	"moderation_rights_case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"request_type" varchar(24) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"details" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'SUBMITTED' NOT NULL,
	"resolution" text,
	"legal_hold_until" timestamp with time zone,
	"due_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_rights_cases_request_type_check" CHECK ("moderation_rights_cases"."request_type" in ('PRIVACY', 'DEFAMATION', 'COPYRIGHT')),
	CONSTRAINT "moderation_rights_cases_target_type_check" CHECK ("moderation_rights_cases"."target_type" in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')),
	CONSTRAINT "moderation_rights_cases_status_check" CHECK ("moderation_rights_cases"."status" in ('SUBMITTED', 'IN_REVIEW', 'ACTIONED', 'DISMISSED', 'WITHDRAWN')),
	CONSTRAINT "moderation_rights_cases_details_check" CHECK (char_length("moderation_rights_cases"."details") between 20 and 4000),
	CONSTRAINT "moderation_rights_cases_resolution_check" CHECK (("moderation_rights_cases"."status" in ('SUBMITTED', 'IN_REVIEW', 'WITHDRAWN')) or ("moderation_rights_cases"."resolved_at" is not null and char_length("moderation_rights_cases"."resolution") between 10 and 4000))
);
--> statement-breakpoint
ALTER TABLE "moderation_audit_events" DROP CONSTRAINT "moderation_audit_events_entity_check";--> statement-breakpoint
ALTER TABLE "moderation_audit_events" DROP CONSTRAINT "moderation_audit_events_actor_check";--> statement-breakpoint
ALTER TABLE "member_moderation_notices" ADD CONSTRAINT "member_moderation_notices_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_rights_cases" ADD CONSTRAINT "moderation_rights_cases_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_moderation_notices_member_created_idx" ON "member_moderation_notices" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_moderation_notices_target_created_idx" ON "member_moderation_notices" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_appeals_member_submitted_idx" ON "moderation_appeals" USING btree ("member_id","submitted_at");--> statement-breakpoint
CREATE INDEX "moderation_appeals_status_submitted_idx" ON "moderation_appeals" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "moderation_appeals_target_idx" ON "moderation_appeals" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "moderation_rights_cases_member_submitted_idx" ON "moderation_rights_cases" USING btree ("member_id","submitted_at");--> statement-breakpoint
CREATE INDEX "moderation_rights_cases_status_due_idx" ON "moderation_rights_cases" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "moderation_rights_cases_target_idx" ON "moderation_rights_cases" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "moderation_audit_events" ADD CONSTRAINT "moderation_audit_events_entity_check" CHECK ("moderation_audit_events"."entity_type" in ('TARGET', 'RUN', 'CASE', 'ACTION', 'RECONCILIATION', 'NOTICE', 'APPEAL', 'RIGHTS_REQUEST'));--> statement-breakpoint
ALTER TABLE "moderation_audit_events" ADD CONSTRAINT "moderation_audit_events_actor_check" CHECK ("moderation_audit_events"."actor_type" in ('MEMBER', 'OPERATOR', 'SYSTEM'));