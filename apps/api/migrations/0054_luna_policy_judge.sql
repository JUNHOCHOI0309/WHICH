CREATE TABLE "policy_judge_budgets" (
	"day" varchar(10) PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"committed_micros" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "policy_judge_budget_nonnegative" CHECK ("policy_judge_budgets"."calls" >= 0 and "policy_judge_budgets"."committed_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policy_judge_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_run_id" uuid NOT NULL,
	"profile" varchar(64) NOT NULL,
	"cache_key" varchar(64),
	"status" varchar(24) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"budget_day" varchar(10),
	"reserved_micros" integer DEFAULT 0 NOT NULL,
	"charged_micros" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "policy_judge_source_profile_unique" UNIQUE("source_run_id","profile"),
	CONSTRAINT "policy_judge_status_check" CHECK ("policy_judge_evaluations"."status" in ('RUNNING', 'SUCCEEDED', 'ABSTAINED', 'FAILED', 'UNKNOWN', 'STALE', 'SKIPPED', 'CACHE_HIT')),
	CONSTRAINT "policy_judge_cost_nonnegative" CHECK ("policy_judge_evaluations"."reserved_micros" >= 0 and "policy_judge_evaluations"."charged_micros" >= 0 and ("policy_judge_evaluations"."cost_micros" is null or "policy_judge_evaluations"."cost_micros" >= 0))
);
--> statement-breakpoint
ALTER TABLE "policy_judge_evaluations" ADD CONSTRAINT "policy_judge_evaluations_source_run_id_moderation_runs_moderation_run_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."moderation_runs"("moderation_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_judge_evaluations" ADD CONSTRAINT "policy_judge_evaluations_budget_day_policy_judge_budgets_day_fk" FOREIGN KEY ("budget_day") REFERENCES "public"."policy_judge_budgets"("day") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_judge_cache_status_idx" ON "policy_judge_evaluations" USING btree ("cache_key","status");--> statement-breakpoint
CREATE INDEX "policy_judge_created_idx" ON "policy_judge_evaluations" USING btree ("created_at");