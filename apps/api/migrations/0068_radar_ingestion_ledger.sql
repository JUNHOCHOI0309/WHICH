CREATE TABLE "radar_ingestion_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_key" varchar(128) NOT NULL,
	"source_code" varchar(32) NOT NULL,
	"operation" varchar(200) NOT NULL,
	"quota_scope_id" varchar(200) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"missing_coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" varchar(32),
	"last_error" varchar(2000),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_ingestion_runs_dispatch_unique" UNIQUE("dispatch_key"),
	CONSTRAINT "radar_runs_dispatch_check" CHECK ("radar_ingestion_runs"."dispatch_key" ~ '^[0-9a-zA-Z:_-]{1,128}$'),
	CONSTRAINT "radar_runs_status_check" CHECK ("radar_ingestion_runs"."status" in ('PENDING','RUNNING','SUCCEEDED','EMPTY_VALID','PARTIAL','FAILED')),
	CONSTRAINT "radar_runs_failure_check" CHECK ("radar_ingestion_runs"."failure_code" is null or "radar_ingestion_runs"."failure_code" in ('RATE_LIMIT','TIMEOUT','AUTH','UPSTREAM','INVALID_RESPONSE','BUDGET_EXHAUSTED','POLICY_DENIED','LEASE_EXPIRED')),
	CONSTRAINT "radar_runs_counts_check" CHECK ("radar_ingestion_runs"."attempt_count" >= 0 and "radar_ingestion_runs"."max_attempts" between 1 and 20 and "radar_ingestion_runs"."attempt_count" <= "radar_ingestion_runs"."max_attempts" and "radar_ingestion_runs"."page_count" >= 0 and "radar_ingestion_runs"."observation_count" >= 0),
	CONSTRAINT "radar_runs_lease_check" CHECK (("radar_ingestion_runs"."status" = 'RUNNING' and "radar_ingestion_runs"."claim_token" is not null and "radar_ingestion_runs"."claimed_at" is not null and "radar_ingestion_runs"."lease_expires_at" > "radar_ingestion_runs"."claimed_at" and "radar_ingestion_runs"."completed_at" is null)
        or ("radar_ingestion_runs"."status" <> 'RUNNING' and "radar_ingestion_runs"."claim_token" is null and "radar_ingestion_runs"."claimed_at" is null and "radar_ingestion_runs"."lease_expires_at" is null)),
	CONSTRAINT "radar_runs_terminal_check" CHECK (("radar_ingestion_runs"."status" in ('PENDING','RUNNING') and "radar_ingestion_runs"."completed_at" is null)
        or ("radar_ingestion_runs"."status" in ('SUCCEEDED','EMPTY_VALID','PARTIAL','FAILED') and "radar_ingestion_runs"."completed_at" is not null)),
	CONSTRAINT "radar_runs_result_check" CHECK (("radar_ingestion_runs"."status" = 'SUCCEEDED' and "radar_ingestion_runs"."page_count" > 0 and "radar_ingestion_runs"."observation_count" > 0 and "radar_ingestion_runs"."failure_code" is null and not "radar_ingestion_runs"."truncated" and jsonb_array_length("radar_ingestion_runs"."missing_coverage") = 0)
        or ("radar_ingestion_runs"."status" = 'EMPTY_VALID' and "radar_ingestion_runs"."page_count" > 0 and "radar_ingestion_runs"."observation_count" = 0 and "radar_ingestion_runs"."failure_code" is null and not "radar_ingestion_runs"."truncated" and jsonb_array_length("radar_ingestion_runs"."missing_coverage") = 0)
        or ("radar_ingestion_runs"."status" = 'PARTIAL' and "radar_ingestion_runs"."page_count" > 0 and "radar_ingestion_runs"."observation_count" > 0 and "radar_ingestion_runs"."failure_code" is not null and ("radar_ingestion_runs"."truncated" or jsonb_array_length("radar_ingestion_runs"."missing_coverage") > 0))
        or ("radar_ingestion_runs"."status" = 'FAILED' and "radar_ingestion_runs"."failure_code" is not null and "radar_ingestion_runs"."observation_count" = 0)
        or ("radar_ingestion_runs"."status" in ('PENDING','RUNNING') and "radar_ingestion_runs"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "radar_provider_requests" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"operation" varchar(200) NOT NULL,
	"pool" varchar(200) NOT NULL,
	"unit_cost" integer NOT NULL,
	"status" varchar(16) DEFAULT 'RESERVED' NOT NULL,
	"http_status" integer,
	"failure_code" varchar(32),
	"retryable" boolean,
	"reserved_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "radar_provider_requests_key_unique" UNIQUE("run_id","request_key"),
	CONSTRAINT "radar_provider_requests_key_check" CHECK ("radar_provider_requests"."request_key" ~ '^[0-9a-zA-Z:_-]{1,128}$'),
	CONSTRAINT "radar_provider_requests_state_check" CHECK (("radar_provider_requests"."status" = 'RESERVED' and "radar_provider_requests"."completed_at" is null and "radar_provider_requests"."http_status" is null and "radar_provider_requests"."failure_code" is null and "radar_provider_requests"."retryable" is null)
        or ("radar_provider_requests"."status" = 'SUCCEEDED' and "radar_provider_requests"."completed_at" is not null and "radar_provider_requests"."failure_code" is null and "radar_provider_requests"."retryable" = false)
        or ("radar_provider_requests"."status" = 'FAILED' and "radar_provider_requests"."completed_at" is not null and "radar_provider_requests"."failure_code" is not null and "radar_provider_requests"."retryable" is not null)),
	CONSTRAINT "radar_provider_requests_failure_check" CHECK ("radar_provider_requests"."failure_code" is null or "radar_provider_requests"."failure_code" in ('RATE_LIMIT','TIMEOUT','AUTH','UPSTREAM','INVALID_RESPONSE','BUDGET_EXHAUSTED','POLICY_DENIED','LEASE_EXPIRED')),
	CONSTRAINT "radar_provider_requests_value_check" CHECK ("radar_provider_requests"."unit_cost" > 0 and ("radar_provider_requests"."http_status" is null or "radar_provider_requests"."http_status" between 100 and 599))
);
--> statement-breakpoint
CREATE TABLE "radar_quota_daily_usage" (
	"policy_version" varchar(64) NOT NULL,
	"source_code" varchar(32) NOT NULL,
	"quota_scope_id" varchar(200) NOT NULL,
	"pool" varchar(200) NOT NULL,
	"day_key" date NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_quota_daily_usage_pk" PRIMARY KEY("policy_version","source_code","quota_scope_id","pool","day_key"),
	CONSTRAINT "radar_quota_daily_counts_check" CHECK ("radar_quota_daily_usage"."request_count" >= 0 and "radar_quota_daily_usage"."unit_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "radar_run_quota_usage" (
	"run_id" uuid NOT NULL,
	"pool" varchar(200) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_run_quota_usage_pk" PRIMARY KEY("run_id","pool"),
	CONSTRAINT "radar_run_quota_counts_check" CHECK ("radar_run_quota_usage"."request_count" >= 0 and "radar_run_quota_usage"."unit_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "radar_ingestion_runs" ADD CONSTRAINT "radar_ingestion_runs_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_provider_requests" ADD CONSTRAINT "radar_provider_requests_run_id_radar_ingestion_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."radar_ingestion_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_quota_daily_usage" ADD CONSTRAINT "radar_quota_daily_usage_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_run_quota_usage" ADD CONSTRAINT "radar_run_quota_usage_run_id_radar_ingestion_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."radar_ingestion_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radar_runs_claim_idx" ON "radar_ingestion_runs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "radar_runs_source_sample_idx" ON "radar_ingestion_runs" USING btree ("source_code","sampled_at");--> statement-breakpoint
CREATE INDEX "radar_runs_lease_idx" ON "radar_ingestion_runs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "radar_provider_requests_run_idx" ON "radar_provider_requests" USING btree ("run_id","reserved_at");
