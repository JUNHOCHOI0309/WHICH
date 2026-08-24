CREATE TYPE "public"."choice_code" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."feed_eligibility" AS ENUM('ELIGIBLE', 'DEPRIORITIZED', 'EXCLUDED', 'FROZEN');--> statement-breakpoint
CREATE TYPE "public"."issue_lifecycle" AS ENUM('PUBLISHED', 'CLOSED', 'ARCHIVED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."issue_participation" AS ENUM('VOTING_OPEN', 'VOTING_CHALLENGED', 'VOTING_SUSPENDED', 'VOTING_CLOSED');--> statement-breakpoint
CREATE TYPE "public"."issue_visibility" AS ENUM('VISIBLE', 'LIMITED', 'UNDER_REVIEW', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."result_integrity_state" AS ENUM('NORMAL', 'MONITORING', 'DEGRADED', 'UNDER_REVIEW', 'RESULT_LOCKED', 'CORRECTED');--> statement-breakpoint
CREATE TYPE "public"."result_visibility" AS ENUM('PRE_VOTE_HIDDEN', 'RESULT_VISIBLE', 'RESULT_LOCKED', 'RESULT_DEGRADED', 'RESULT_UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."subject_kind" AS ENUM('GUEST', 'MEMBER', 'VERIFIED_MEMBER', 'DELETED_MEMBER');--> statement-breakpoint
CREATE TYPE "public"."vote_action" AS ENUM('RESTORED', 'MERGED', 'RECLASSIFIED', 'AGGREGATE_REBUILT');--> statement-breakpoint
CREATE TYPE "public"."vote_integrity_state" AS ENUM('ACCEPTED', 'REVIEW', 'REJECTED_DUPLICATE', 'REJECTED_ABUSE', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."vote_request_state" AS ENUM('RECEIVED', 'VALIDATING', 'CHALLENGE_REQUIRED', 'CHALLENGE_PASSED', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');--> statement-breakpoint
CREATE TABLE "issue_choices" (
	"choice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_code" "choice_code" NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_choices_issue_version_code_unique" UNIQUE("issue_id","issue_version","choice_code"),
	CONSTRAINT "issue_choices_issue_version_id_unique" UNIQUE("issue_id","issue_version","choice_id")
);
--> statement-breakpoint
CREATE TABLE "issue_versions" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"question" text NOT NULL,
	"context" text,
	"content_hash" varchar(64) NOT NULL,
	"primary_category_code" varchar(64) NOT NULL,
	"experience_mode_code" varchar(64) NOT NULL,
	"taxonomy_version" varchar(32) NOT NULL,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_versions_pk" PRIMARY KEY("issue_id","issue_version"),
	CONSTRAINT "issue_versions_positive_version_check" CHECK ("issue_versions"."issue_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"issue_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"successor_issue_id" uuid,
	"lifecycle" "issue_lifecycle" DEFAULT 'PUBLISHED' NOT NULL,
	"visibility" "issue_visibility" DEFAULT 'VISIBLE' NOT NULL,
	"participation" "issue_participation" DEFAULT 'VOTING_OPEN' NOT NULL,
	"result_visibility" "result_visibility" DEFAULT 'PRE_VOTE_HIDDEN' NOT NULL,
	"feed_eligibility" "feed_eligibility" DEFAULT 'ELIGIBLE' NOT NULL,
	"risk_level" "risk_level" DEFAULT 'LOW' NOT NULL,
	"is_political" boolean DEFAULT false NOT NULL,
	"vote_open_at" timestamp with time zone,
	"vote_close_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_vote_window_check" CHECK ("issues"."vote_close_at" is null or "issues"."vote_open_at" is null or "issues"."vote_close_at" > "issues"."vote_open_at"),
	CONSTRAINT "issues_political_risk_check" CHECK (not "issues"."is_political" or "issues"."risk_level" = 'RESTRICTED')
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "outbox_events_schema_version_check" CHECK ("outbox_events"."schema_version" > 0),
	CONSTRAINT "outbox_events_attempt_count_check" CHECK ("outbox_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "result_snapshots" (
	"tally_snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"result_version" integer NOT NULL,
	"accepted_a_count" integer NOT NULL,
	"accepted_b_count" integer NOT NULL,
	"displayed_vote_count" integer NOT NULL,
	"integrity_state" "result_integrity_state" NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_snapshots_issue_result_version_unique" UNIQUE("issue_id","issue_version","result_version"),
	CONSTRAINT "result_snapshots_counts_check" CHECK ("result_snapshots"."result_version" > 0 and "result_snapshots"."accepted_a_count" >= 0 and "result_snapshots"."accepted_b_count" >= 0 and "result_snapshots"."displayed_vote_count" = "result_snapshots"."accepted_a_count" + "result_snapshots"."accepted_b_count")
);
--> statement-breakpoint
CREATE TABLE "vote_aggregates" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"result_version" integer DEFAULT 1 NOT NULL,
	"vote_request_count" integer DEFAULT 0 NOT NULL,
	"accepted_a_count" integer DEFAULT 0 NOT NULL,
	"accepted_b_count" integer DEFAULT 0 NOT NULL,
	"accepted_vote_count" integer DEFAULT 0 NOT NULL,
	"review_vote_count" integer DEFAULT 0 NOT NULL,
	"rejected_duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_abuse_count" integer DEFAULT 0 NOT NULL,
	"invalidated_vote_count" integer DEFAULT 0 NOT NULL,
	"displayed_vote_count" integer DEFAULT 0 NOT NULL,
	"integrity_state" "result_integrity_state" DEFAULT 'NORMAL' NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_aggregates_pk" PRIMARY KEY("issue_id","issue_version"),
	CONSTRAINT "vote_aggregates_result_version_check" CHECK ("vote_aggregates"."result_version" > 0),
	CONSTRAINT "vote_aggregates_counts_check" CHECK ("vote_aggregates"."vote_request_count" >= 0 and "vote_aggregates"."accepted_a_count" >= 0 and "vote_aggregates"."accepted_b_count" >= 0
        and "vote_aggregates"."review_vote_count" >= 0 and "vote_aggregates"."rejected_duplicate_count" >= 0 and "vote_aggregates"."rejected_abuse_count" >= 0
        and "vote_aggregates"."invalidated_vote_count" >= 0 and "vote_aggregates"."accepted_vote_count" = "vote_aggregates"."accepted_a_count" + "vote_aggregates"."accepted_b_count"
        and "vote_aggregates"."displayed_vote_count" = "vote_aggregates"."accepted_vote_count")
);
--> statement-breakpoint
CREATE TABLE "voter_subjects" (
	"subject_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" "subject_kind" NOT NULL,
	"anonymous_subject_id" uuid,
	"user_id" uuid,
	"verified_uniqueness_handle" text,
	"expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voter_subjects_identity_shape_check" CHECK (("voter_subjects"."subject_kind" = 'GUEST' and "voter_subjects"."anonymous_subject_id" is not null and "voter_subjects"."user_id" is null and "voter_subjects"."verified_uniqueness_handle" is null)
        or ("voter_subjects"."subject_kind" = 'MEMBER' and "voter_subjects"."anonymous_subject_id" is null and "voter_subjects"."user_id" is not null and "voter_subjects"."verified_uniqueness_handle" is null)
        or ("voter_subjects"."subject_kind" = 'VERIFIED_MEMBER' and "voter_subjects"."anonymous_subject_id" is null and "voter_subjects"."user_id" is not null and "voter_subjects"."verified_uniqueness_handle" is not null))
);
--> statement-breakpoint
CREATE TABLE "vote_attempts" (
	"vote_attempt_id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"request_state" "vote_request_state" DEFAULT 'RECEIVED' NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_snapshot" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "vote_attempts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "vote_integrity_decisions" (
	"vote_integrity_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"from_state" "vote_integrity_state",
	"to_state" "vote_integrity_state" NOT NULL,
	"action" "vote_action",
	"reason_code" varchar(64) NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"evidence" jsonb,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_integrity_decisions_vote_revision_unique" UNIQUE("vote_id","revision"),
	CONSTRAINT "vote_integrity_decisions_positive_revision_check" CHECK ("vote_integrity_decisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"vote_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_attempt_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"integrity_state" "vote_integrity_state" NOT NULL,
	"reason_code" varchar(64),
	"user_tier" varchar(32) NOT NULL,
	"account_assurance" varchar(32) NOT NULL,
	"uniqueness_assurance" varchar(32) NOT NULL,
	"issue_risk_level" "risk_level" NOT NULL,
	"eligibility_policy_version" varchar(32) NOT NULL,
	"integrity_policy_version" varchar(32) NOT NULL,
	"verification_scope" varchar(64),
	"is_test_subject" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_vote_attempt_unique" UNIQUE("vote_attempt_id"),
	CONSTRAINT "votes_integrity_timestamps_check" CHECK (("votes"."integrity_state" = 'ACCEPTED' and "votes"."accepted_at" is not null and "votes"."invalidated_at" is null)
        or ("votes"."integrity_state" = 'INVALIDATED' and "votes"."accepted_at" is not null and "votes"."invalidated_at" is not null)
        or "votes"."integrity_state" in ('REVIEW', 'REJECTED_DUPLICATE', 'REJECTED_ABUSE'))
);
--> statement-breakpoint
ALTER TABLE "issue_choices" ADD CONSTRAINT "issue_choices_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_versions" ADD CONSTRAINT "issue_versions_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_successor_issue_fk" FOREIGN KEY ("successor_issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_snapshots" ADD CONSTRAINT "result_snapshots_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_aggregates" ADD CONSTRAINT "vote_aggregates_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_attempts" ADD CONSTRAINT "vote_attempts_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_attempts" ADD CONSTRAINT "vote_attempts_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_attempts" ADD CONSTRAINT "vote_attempts_choice_fk" FOREIGN KEY ("issue_id","issue_version","choice_id") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_integrity_decisions" ADD CONSTRAINT "vote_integrity_decisions_vote_id_votes_vote_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("vote_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_vote_attempt_id_vote_attempts_vote_attempt_id_fk" FOREIGN KEY ("vote_attempt_id") REFERENCES "public"."vote_attempts"("vote_attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_choice_fk" FOREIGN KEY ("issue_id","issue_version","choice_id") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at","occurred_at") WHERE "outbox_events"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "voter_subjects_anonymous_unique" ON "voter_subjects" USING btree ("anonymous_subject_id") WHERE "voter_subjects"."anonymous_subject_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "voter_subjects_user_unique" ON "voter_subjects" USING btree ("user_id") WHERE "voter_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "voter_subjects_verified_handle_unique" ON "voter_subjects" USING btree ("verified_uniqueness_handle") WHERE "voter_subjects"."verified_uniqueness_handle" is not null;--> statement-breakpoint
CREATE INDEX "vote_attempts_subject_received_idx" ON "vote_attempts" USING btree ("subject_id","received_at");--> statement-breakpoint
CREATE INDEX "vote_integrity_decisions_vote_decided_idx" ON "vote_integrity_decisions" USING btree ("vote_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_one_accepted_per_issue_subject_unique" ON "votes" USING btree ("issue_id","subject_id") WHERE "votes"."integrity_state" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "votes_issue_version_integrity_idx" ON "votes" USING btree ("issue_id","issue_version","integrity_state");
