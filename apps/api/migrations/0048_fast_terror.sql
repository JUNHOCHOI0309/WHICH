CREATE TABLE "moderation_provider_call_cache" (
	"provider_call_cache_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(48) NOT NULL,
	"model_name" varchar(96) NOT NULL,
	"model_version" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"normalized_input_hash" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(96),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_provider_call_cache_execution_unique" UNIQUE("provider","model_name","model_version","policy_version","normalized_input_hash"),
	CONSTRAINT "moderation_provider_call_cache_hash_check" CHECK ("moderation_provider_call_cache"."normalized_input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "moderation_provider_call_cache_status_check" CHECK ("moderation_provider_call_cache"."status" in ('SUCCEEDED', 'FAILED', 'SKIPPED')),
	CONSTRAINT "moderation_provider_call_cache_latency_check" CHECK ("moderation_provider_call_cache"."latency_ms" >= 0),
	CONSTRAINT "moderation_provider_call_cache_cost_check" CHECK ("moderation_provider_call_cache"."cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "moderation_runs" DROP CONSTRAINT "moderation_runs_status_check";--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "mode" varchar(16) DEFAULT 'SHADOW' NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "total_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "moderation_provider_call_cache_expiry_idx" ON "moderation_provider_call_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_runs_source_event_unique" ON "moderation_runs" USING btree ("source_event_id") WHERE "moderation_runs"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "moderation_runs_pending_available_idx" ON "moderation_runs" USING btree ("available_at","created_at") WHERE "moderation_runs"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_attempt_count_check" CHECK ("moderation_runs"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_total_attempt_count_check" CHECK ("moderation_runs"."total_attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_mode_check" CHECK ("moderation_runs"."mode" = 'SHADOW');--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_claim_check" CHECK (("moderation_runs"."status" = 'RUNNING' and "moderation_runs"."claim_token" is not null and "moderation_runs"."claimed_at" is not null)
        or ("moderation_runs"."status" <> 'RUNNING' and "moderation_runs"."claim_token" is null and "moderation_runs"."claimed_at" is null));--> statement-breakpoint
ALTER TABLE "moderation_runs" ADD CONSTRAINT "moderation_runs_status_check" CHECK ("moderation_runs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'DEAD_LETTERED'));