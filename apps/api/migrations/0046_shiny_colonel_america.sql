CREATE TABLE "issue_media_known_block_hashes" (
	"sha256" varchar(64) PRIMARY KEY NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "issue_media_known_block_hashes_sha_check" CHECK ("issue_media_known_block_hashes"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "issue_media_rule_findings" (
	"finding_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_session_id" uuid,
	"media_asset_id" uuid,
	"stage" varchar(32) NOT NULL,
	"code" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"source_version" varchar(64) NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_rule_findings_target_check" CHECK ("issue_media_rule_findings"."upload_session_id" is not null or "issue_media_rule_findings"."media_asset_id" is not null),
	CONSTRAINT "issue_media_rule_findings_severity_check" CHECK ("issue_media_rule_findings"."severity" in ('INFO', 'REVIEW', 'BLOCK'))
);
--> statement-breakpoint
CREATE TABLE "issue_media_upload_sessions" (
	"upload_session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"member_pseudonym" varchar(64) NOT NULL,
	"ip_pseudonym" varchar(64) NOT NULL,
	"state" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"max_bytes" integer NOT NULL,
	"consumed_bytes" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_upload_sessions_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "issue_media_upload_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "issue_media_upload_sessions_state_check" CHECK ("issue_media_upload_sessions"."state" in ('CREATED', 'CONSUMED', 'EXPIRED', 'REJECTED')),
	CONSTRAINT "issue_media_upload_sessions_byte_check" CHECK ("issue_media_upload_sessions"."max_bytes" between 1 and 10485760 and ("issue_media_upload_sessions"."consumed_bytes" is null or "issue_media_upload_sessions"."consumed_bytes" between 1 and "issue_media_upload_sessions"."max_bytes")),
	CONSTRAINT "issue_media_upload_sessions_expiry_check" CHECK ("issue_media_upload_sessions"."expires_at" > "issue_media_upload_sessions"."created_at"),
	CONSTRAINT "issue_media_upload_sessions_consumed_check" CHECK (("issue_media_upload_sessions"."state" = 'CONSUMED' and "issue_media_upload_sessions"."consumed_at" is not null and "issue_media_upload_sessions"."consumed_bytes" is not null) or ("issue_media_upload_sessions"."state" <> 'CONSUMED'))
);
--> statement-breakpoint
CREATE TABLE "member_capability_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"rationale" text NOT NULL,
	"actor_member_id" uuid,
	"request_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_capability_events_action_check" CHECK ("member_capability_events"."action" in ('GRANTED', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'APPEALED', 'RESTORED')),
	CONSTRAINT "member_capability_events_rationale_check" CHECK (char_length("member_capability_events"."rationale") >= 10)
);
--> statement-breakpoint
CREATE TABLE "member_capability_grants" (
	"grant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"capability_code" varchar(64) NOT NULL,
	"state" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"granted_by_member_id" uuid,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_capability_grants_code_check" CHECK ("member_capability_grants"."capability_code" = 'ISSUE_IMAGE_UPLOAD'),
	CONSTRAINT "member_capability_grants_state_check" CHECK ("member_capability_grants"."state" in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
	CONSTRAINT "member_capability_grants_reason_check" CHECK (char_length("member_capability_grants"."reason") >= 10),
	CONSTRAINT "member_capability_grants_expiry_check" CHECK ("member_capability_grants"."expires_at" > "member_capability_grants"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "member_media_consents" (
	"consent_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"consent_version" varchar(64) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "member_media_consents_member_version_unique" UNIQUE("member_id","consent_version"),
	CONSTRAINT "member_media_consents_revocation_check" CHECK ("member_media_consents"."revoked_at" is null or "member_media_consents"."revoked_at" >= "member_media_consents"."accepted_at")
);
--> statement-breakpoint
ALTER TABLE "issue_media_rule_findings" ADD CONSTRAINT "issue_media_rule_findings_upload_session_id_issue_media_upload_sessions_upload_session_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."issue_media_upload_sessions"("upload_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_rule_findings" ADD CONSTRAINT "issue_media_rule_findings_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_upload_sessions" ADD CONSTRAINT "issue_media_upload_sessions_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_upload_sessions" ADD CONSTRAINT "issue_media_upload_sessions_submission_id_member_issue_submissions_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."member_issue_submissions"("submission_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capability_events" ADD CONSTRAINT "member_capability_events_grant_id_member_capability_grants_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."member_capability_grants"("grant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capability_events" ADD CONSTRAINT "member_capability_events_actor_member_id_members_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("member_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capability_grants" ADD CONSTRAINT "member_capability_grants_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capability_grants" ADD CONSTRAINT "member_capability_grants_granted_by_member_id_members_member_id_fk" FOREIGN KEY ("granted_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_media_consents" ADD CONSTRAINT "member_media_consents_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_media_known_block_hashes_active_idx" ON "issue_media_known_block_hashes" USING btree ("active","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_rule_findings_session_created_idx" ON "issue_media_rule_findings" USING btree ("upload_session_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_rule_findings_asset_created_idx" ON "issue_media_rule_findings" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_upload_sessions_member_created_idx" ON "issue_media_upload_sessions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_upload_sessions_ip_created_idx" ON "issue_media_upload_sessions" USING btree ("ip_pseudonym","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_upload_sessions_state_expiry_idx" ON "issue_media_upload_sessions" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "member_capability_events_grant_created_idx" ON "member_capability_events" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_capability_grants_member_capability_unique" ON "member_capability_grants" USING btree ("member_id","capability_code");--> statement-breakpoint
CREATE INDEX "member_capability_grants_state_expiry_idx" ON "member_capability_grants" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "member_media_consents_member_accepted_idx" ON "member_media_consents" USING btree ("member_id","accepted_at");