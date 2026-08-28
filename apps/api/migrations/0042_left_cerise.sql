CREATE TABLE "moderation_actions" (
	"moderation_action_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_case_id" uuid NOT NULL,
	"action_type" varchar(48) NOT NULL,
	"domain_decision_type" varchar(48) NOT NULL,
	"domain_decision_id" uuid NOT NULL,
	"actor_type" varchar(24) NOT NULL,
	"actor_member_id" uuid,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"duration_seconds" integer,
	"expires_at" timestamp with time zone,
	"reversal_of_action_id" uuid,
	"notice_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_domain_decision_unique" UNIQUE("domain_decision_type","domain_decision_id"),
	CONSTRAINT "moderation_actions_decision_type_check" CHECK ("moderation_actions"."domain_decision_type" in ('COMMENT_MODERATION_DECISION', 'ISSUE_MEDIA_REVIEW_DECISION')),
	CONSTRAINT "moderation_actions_actor_check" CHECK ("moderation_actions"."actor_type" in ('OPERATOR', 'SYSTEM')),
	CONSTRAINT "moderation_actions_actor_member_check" CHECK (("moderation_actions"."actor_type" = 'OPERATOR' and "moderation_actions"."actor_member_id" is not null) or "moderation_actions"."actor_type" = 'SYSTEM'),
	CONSTRAINT "moderation_actions_duration_check" CHECK ("moderation_actions"."duration_seconds" is null or "moderation_actions"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_audit_events" (
	"moderation_audit_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_type" varchar(24) NOT NULL,
	"actor_member_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_audit_events_entity_check" CHECK ("moderation_audit_events"."entity_type" in ('TARGET', 'RUN', 'CASE', 'ACTION', 'RECONCILIATION')),
	CONSTRAINT "moderation_audit_events_actor_check" CHECK ("moderation_audit_events"."actor_type" in ('OPERATOR', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "moderation_case_references" (
	"moderation_case_reference_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_case_id" uuid NOT NULL,
	"reference_type" varchar(32) NOT NULL,
	"reference_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_case_references_unique" UNIQUE("moderation_case_id","reference_type","reference_id"),
	CONSTRAINT "moderation_case_references_type_check" CHECK ("moderation_case_references"."reference_type" in ('CONTENT_REPORT', 'COMMENT_REPORT', 'RIGHTS_REQUEST', 'APPEAL', 'RECONCILIATION'))
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"moderation_case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_target_id" uuid NOT NULL,
	"latest_run_id" uuid,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"risk_lane" varchar(24) NOT NULL,
	"priority" varchar(8) NOT NULL,
	"sla_due_at" timestamp with time zone,
	"assigned_to_member_id" uuid,
	"expected_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_cases_revision_check" CHECK ("moderation_cases"."expected_revision" > 0),
	CONSTRAINT "moderation_cases_status_check" CHECK ("moderation_cases"."status" in ('OPEN', 'TRIAGED', 'IN_REVIEW', 'RESOLVED', 'CANCELLED')),
	CONSTRAINT "moderation_cases_risk_lane_check" CHECK ("moderation_cases"."risk_lane" in ('ALLOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'RIGHTS')),
	CONSTRAINT "moderation_cases_priority_check" CHECK ("moderation_cases"."priority" in ('P0', 'P1', 'P2', 'P3'))
);
--> statement-breakpoint
CREATE TABLE "moderation_reconciliations" (
	"moderation_reconciliation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_case_id" uuid,
	"moderation_target_id" uuid NOT NULL,
	"resource_type" varchar(24) NOT NULL,
	"expected_reference" varchar(512) NOT NULL,
	"observed_reference" varchar(512),
	"status" varchar(24) NOT NULL,
	"repair_reference" varchar(512),
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "moderation_reconciliations_resource_check" CHECK ("moderation_reconciliations"."resource_type" in ('DATABASE', 'R2', 'CDN')),
	CONSTRAINT "moderation_reconciliations_status_check" CHECK ("moderation_reconciliations"."status" in ('CONSISTENT', 'MISMATCH', 'REPAIRED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "moderation_runs" (
	"moderation_run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_target_id" uuid NOT NULL,
	"recheck_request_id" uuid,
	"policy_version" varchar(64) NOT NULL,
	"stage" varchar(32) NOT NULL,
	"normalized_input_hash" varchar(64) NOT NULL,
	"model_provider" varchar(48),
	"model_name" varchar(96),
	"model_version" varchar(64),
	"rule_version" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"decision_source" varchar(24) NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" integer,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(96),
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_runs_deduplication_unique" UNIQUE("moderation_target_id","policy_version","stage","normalized_input_hash"),
	CONSTRAINT "moderation_runs_input_hash_check" CHECK ("moderation_runs"."normalized_input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "moderation_runs_latency_check" CHECK ("moderation_runs"."latency_ms" is null or "moderation_runs"."latency_ms" >= 0),
	CONSTRAINT "moderation_runs_cost_check" CHECK ("moderation_runs"."cost_micros" >= 0),
	CONSTRAINT "moderation_runs_status_check" CHECK ("moderation_runs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
	CONSTRAINT "moderation_runs_source_check" CHECK ("moderation_runs"."decision_source" in ('RULE', 'MODEL', 'OPERATOR', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "moderation_targets" (
	"moderation_target_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_version" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"snapshot_reference" varchar(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_targets_natural_key_unique" UNIQUE("target_type","target_id","target_version"),
	CONSTRAINT "moderation_targets_positive_version_check" CHECK ("moderation_targets"."target_version" > 0),
	CONSTRAINT "moderation_targets_type_check" CHECK ("moderation_targets"."target_type" in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')),
	CONSTRAINT "moderation_targets_input_hash_check" CHECK ("moderation_targets"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderation_case_id_moderation_cases_moderation_case_id_fk" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("moderation_case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_member_id_members_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit_events" ADD CONSTRAINT "moderation_audit_events_actor_member_id_members_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_case_references" ADD CONSTRAINT "moderation_case_references_moderation_case_id_moderation_cases_moderation_case_id_fk" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("moderation_case_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_moderation_target_id_moderation_targets_moderation_target_id_fk" FOREIGN KEY ("moderation_target_id") REFERENCES "public"."moderation_targets"("moderation_target_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_latest_run_id_moderation_runs_moderation_run_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "public"."moderation_runs"("moderation_run_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assigned_to_member_id_members_member_id_fk" FOREIGN KEY ("assigned_to_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reconciliations" ADD CONSTRAINT "moderation_reconciliations_moderation_case_id_moderation_cases_moderation_case_id_fk" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("moderation_case_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reconciliations" ADD CONSTRAINT "moderation_reconciliations_moderation_target_id_moderation_targets_moderation_target_id_fk" FOREIGN KEY ("moderation_target_id") REFERENCES "public"."moderation_targets"("moderation_target_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_moderation_target_id_moderation_targets_moderation_target_id_fk" FOREIGN KEY ("moderation_target_id") REFERENCES "public"."moderation_targets"("moderation_target_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_recheck_request_id_moderation_recheck_requests_moderation_recheck_request_id_fk" FOREIGN KEY ("recheck_request_id") REFERENCES "public"."moderation_recheck_requests"("moderation_recheck_request_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_actions_case_created_idx" ON "moderation_actions" USING btree ("moderation_case_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_audit_events_entity_occurred_idx" ON "moderation_audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "moderation_cases_queue_idx" ON "moderation_cases" USING btree ("status","priority","sla_due_at");--> statement-breakpoint
CREATE INDEX "moderation_cases_target_created_idx" ON "moderation_cases" USING btree ("moderation_target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_reconciliations_status_checked_idx" ON "moderation_reconciliations" USING btree ("status","checked_at");--> statement-breakpoint
CREATE INDEX "moderation_runs_status_created_idx" ON "moderation_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_targets_lookup_idx" ON "moderation_targets" USING btree ("target_type","target_id","target_version");