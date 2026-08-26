ALTER TABLE "recommendation_items" ADD COLUMN "candidate_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "score_components" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "quality_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "shadow_position" integer;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "controversy_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "quality_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD COLUMN "eligibility_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_requests" ADD COLUMN "policy_version" varchar(32) DEFAULT 'interest-content-v2' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_requests" ADD COLUMN "quality_mode" varchar(16) DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_requests" ADD COLUMN "fallback_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_quality_score_check" CHECK ("recommendation_items"."quality_score" >= 0);--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_shadow_position_check" CHECK ("recommendation_items"."shadow_position" is null or "recommendation_items"."shadow_position" > 0);--> statement-breakpoint
ALTER TABLE "recommendation_requests" ADD CONSTRAINT "recommendation_requests_quality_mode_check" CHECK ("recommendation_requests"."quality_mode" in ('OFF', 'SHADOW', 'LIVE'));