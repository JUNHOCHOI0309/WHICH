CREATE TABLE "operator_access_grants" (
	"operator_access_grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'OPERATOR' NOT NULL,
	"granted_by" varchar(128) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_access_grants_role_check" CHECK ("operator_access_grants"."role" = 'OPERATOR'),
	CONSTRAINT "operator_access_grants_revocation_check" CHECK ("operator_access_grants"."revoked_at" is null or "operator_access_grants"."revoked_at" >= "operator_access_grants"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "operator_audit_logs" (
	"operator_audit_log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"request_id" varchar(128),
	"window_days" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_audit_logs_outcome_check" CHECK ("operator_audit_logs"."outcome" in ('ALLOWED', 'DENIED', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "operator_audit_logs_window_check" CHECK ("operator_audit_logs"."window_days" is null or "operator_audit_logs"."window_days" in (1, 7, 30))
);
--> statement-breakpoint
CREATE TABLE "operator_backup_confirmations" (
	"operator_backup_confirmation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"confirmed_by_member_id" uuid NOT NULL,
	"backup_reference" varchar(256) NOT NULL,
	"notes" varchar(500),
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_access_grants" ADD CONSTRAINT "operator_access_grants_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ADD CONSTRAINT "operator_audit_logs_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_backup_confirmations" ADD CONSTRAINT "operator_backup_confirmations_confirmed_by_member_id_members_member_id_fk" FOREIGN KEY ("confirmed_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_access_grants_active_member_unique" ON "operator_access_grants" USING btree ("member_id") WHERE "operator_access_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "operator_access_grants_member_updated_idx" ON "operator_access_grants" USING btree ("member_id","updated_at");--> statement-breakpoint
CREATE INDEX "operator_audit_logs_member_occurred_idx" ON "operator_audit_logs" USING btree ("member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_audit_logs_event_occurred_idx" ON "operator_audit_logs" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "operator_backup_confirmations_confirmed_idx" ON "operator_backup_confirmations" USING btree ("confirmed_at");