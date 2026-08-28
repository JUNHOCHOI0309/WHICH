CREATE TABLE "content_report_attempts" (
	"content_report_attempt_id" uuid PRIMARY KEY NOT NULL,
	"target_type" varchar(24) NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_subject_id" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_snapshot" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_report_attempts_target_type_check" CHECK ("content_report_attempts"."target_type" in ('ISSUE', 'ISSUE_MEDIA'))
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"content_report_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_case_id" uuid NOT NULL,
	"report_cluster_id" uuid NOT NULL,
	"target_type" varchar(24) NOT NULL,
	"target_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"origin_subject_id" uuid NOT NULL,
	"reporter_kind" varchar(24) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"detail" text,
	"weight_snapshot" integer NOT NULL,
	"account_age_days" integer NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"merged_into_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_target_type_check" CHECK ("content_reports"."target_type" in ('ISSUE', 'ISSUE_MEDIA')),
	CONSTRAINT "content_reports_reporter_kind_check" CHECK ("content_reports"."reporter_kind" in ('GUEST', 'MEMBER', 'VERIFIED_MEMBER')),
	CONSTRAINT "content_reports_weight_check" CHECK ("content_reports"."weight_snapshot" in (1, 2)),
	CONSTRAINT "content_reports_account_age_check" CHECK ("content_reports"."account_age_days" >= 0),
	CONSTRAINT "content_reports_merge_shape_check" CHECK (("content_reports"."counted" = true and "content_reports"."merged_into_report_id" is null)
        or ("content_reports"."counted" = false and "content_reports"."merged_into_report_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "report_cases" (
	"report_case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(24) NOT NULL,
	"target_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"priority" varchar(16) DEFAULT 'NORMAL' NOT NULL,
	"automation_recommendation" varchar(32) DEFAULT 'NONE' NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "report_cases_target_type_check" CHECK ("report_cases"."target_type" in ('ISSUE', 'ISSUE_MEDIA')),
	CONSTRAINT "report_cases_status_check" CHECK ("report_cases"."status" in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW', 'RESOLVED', 'DISMISSED')),
	CONSTRAINT "report_cases_priority_check" CHECK ("report_cases"."priority" in ('NORMAL', 'P0')),
	CONSTRAINT "report_cases_automation_check" CHECK ("report_cases"."automation_recommendation" in ('NONE', 'P0_REVIEW', 'QUARANTINE_REVIEW')),
	CONSTRAINT "report_cases_resolution_check" CHECK (("report_cases"."status" in ('RESOLVED', 'DISMISSED') and "report_cases"."resolved_at" is not null)
        or ("report_cases"."status" not in ('RESOLVED', 'DISMISSED') and "report_cases"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "report_clusters" (
	"report_cluster_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_case_id" uuid NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_minutes" integer DEFAULT 15 NOT NULL,
	"classification" varchar(32) DEFAULT 'BASELINE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_clusters_case_window_unique" UNIQUE("report_case_id","window_started_at"),
	CONSTRAINT "report_clusters_window_check" CHECK ("report_clusters"."window_minutes" = 15),
	CONSTRAINT "report_clusters_classification_check" CHECK ("report_clusters"."classification" in ('BASELINE', 'CONCENTRATED', 'COORDINATED_SUSPECTED'))
);
--> statement-breakpoint
CREATE TABLE "report_signal_snapshots" (
	"report_signal_snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_case_id" uuid NOT NULL,
	"report_cluster_id" uuid NOT NULL,
	"content_report_id" uuid NOT NULL,
	"reporter_count" integer NOT NULL,
	"weighted_score" integer NOT NULL,
	"reports_15m" integer NOT NULL,
	"reports_24h" integer NOT NULL,
	"velocity_per_hour" integer NOT NULL,
	"guest_ratio_bps" integer NOT NULL,
	"new_account_ratio_bps" integer NOT NULL,
	"unique_origin_count" integer NOT NULL,
	"cluster_classification" varchar(32) NOT NULL,
	"shadow_only" boolean DEFAULT true NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_signal_snapshots_nonnegative_check" CHECK ("report_signal_snapshots"."reporter_count" >= 0 and "report_signal_snapshots"."weighted_score" >= 0 and "report_signal_snapshots"."reports_15m" >= 0
        and "report_signal_snapshots"."reports_24h" >= 0 and "report_signal_snapshots"."velocity_per_hour" >= 0
        and "report_signal_snapshots"."unique_origin_count" >= 0),
	CONSTRAINT "report_signal_snapshots_ratio_check" CHECK ("report_signal_snapshots"."guest_ratio_bps" between 0 and 10000 and "report_signal_snapshots"."new_account_ratio_bps" between 0 and 10000),
	CONSTRAINT "report_signal_snapshots_shadow_check" CHECK ("report_signal_snapshots"."shadow_only" = true)
);
--> statement-breakpoint
CREATE TABLE "reporter_signal_snapshots" (
	"reporter_signal_snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_report_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"reports_30d" integer NOT NULL,
	"merged_duplicates_30d" integer NOT NULL,
	"account_age_days" integer NOT NULL,
	"signal_band" varchar(24) DEFAULT 'UNKNOWN' NOT NULL,
	"shadow_only" boolean DEFAULT true NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporter_signal_snapshots_counts_check" CHECK ("reporter_signal_snapshots"."reports_30d" >= 0 and "reporter_signal_snapshots"."merged_duplicates_30d" >= 0 and "reporter_signal_snapshots"."account_age_days" >= 0),
	CONSTRAINT "reporter_signal_snapshots_band_check" CHECK ("reporter_signal_snapshots"."signal_band" in ('UNKNOWN', 'ESTABLISHING', 'RELIABLE', 'ABUSE_SUSPECTED')),
	CONSTRAINT "reporter_signal_snapshots_shadow_check" CHECK ("reporter_signal_snapshots"."shadow_only" = true)
);
--> statement-breakpoint
ALTER TABLE "content_report_attempts" ADD CONSTRAINT "content_report_attempts_actor_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("actor_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_report_case_id_report_cases_report_case_id_fk" FOREIGN KEY ("report_case_id") REFERENCES "public"."report_cases"("report_case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_report_cluster_id_report_clusters_report_cluster_id_fk" FOREIGN KEY ("report_cluster_id") REFERENCES "public"."report_clusters"("report_cluster_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_origin_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("origin_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_merged_into_fk" FOREIGN KEY ("merged_into_report_id") REFERENCES "public"."content_reports"("content_report_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_clusters" ADD CONSTRAINT "report_clusters_report_case_id_report_cases_report_case_id_fk" FOREIGN KEY ("report_case_id") REFERENCES "public"."report_cases"("report_case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_signal_snapshots" ADD CONSTRAINT "report_signal_snapshots_report_case_id_report_cases_report_case_id_fk" FOREIGN KEY ("report_case_id") REFERENCES "public"."report_cases"("report_case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_signal_snapshots" ADD CONSTRAINT "report_signal_snapshots_report_cluster_id_report_clusters_report_cluster_id_fk" FOREIGN KEY ("report_cluster_id") REFERENCES "public"."report_clusters"("report_cluster_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_signal_snapshots" ADD CONSTRAINT "report_signal_snapshots_content_report_id_content_reports_content_report_id_fk" FOREIGN KEY ("content_report_id") REFERENCES "public"."content_reports"("content_report_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporter_signal_snapshots" ADD CONSTRAINT "reporter_signal_snapshots_content_report_id_content_reports_content_report_id_fk" FOREIGN KEY ("content_report_id") REFERENCES "public"."content_reports"("content_report_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporter_signal_snapshots" ADD CONSTRAINT "reporter_signal_snapshots_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_report_attempts_actor_received_idx" ON "content_report_attempts" USING btree ("actor_subject_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_counted_target_subject_unique" ON "content_reports" USING btree ("target_type","target_id","subject_id") WHERE "content_reports"."counted" = true;--> statement-breakpoint
CREATE INDEX "content_reports_case_created_idx" ON "content_reports" USING btree ("report_case_id","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_subject_created_idx" ON "content_reports" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_cases_active_target_unique" ON "report_cases" USING btree ("target_type","target_id") WHERE "report_cases"."status" in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW');--> statement-breakpoint
CREATE INDEX "report_cases_status_updated_idx" ON "report_cases" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "report_clusters_classification_updated_idx" ON "report_clusters" USING btree ("classification","updated_at");--> statement-breakpoint
CREATE INDEX "report_signal_snapshots_case_created_idx" ON "report_signal_snapshots" USING btree ("report_case_id","created_at");--> statement-breakpoint
CREATE INDEX "reporter_signal_snapshots_subject_created_idx" ON "reporter_signal_snapshots" USING btree ("subject_id","created_at");