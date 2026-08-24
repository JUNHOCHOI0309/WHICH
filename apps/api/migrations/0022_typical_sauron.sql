CREATE TABLE "analytics_daily_funnel_metrics_v2" (
	"metric_date" date NOT NULL,
	"source" varchar(32) NOT NULL,
	"medium" varchar(32) NOT NULL,
	"entry_surface" varchar(24) NOT NULL,
	"audience_segment" varchar(16) NOT NULL,
	"device_segment" varchar(16) NOT NULL,
	"qualified_sessions" integer DEFAULT 0 NOT NULL,
	"submit_sessions" integer DEFAULT 0 NOT NULL,
	"accepted_vote_sessions" integer DEFAULT 0 NOT NULL,
	"accepted_votes" integer DEFAULT 0 NOT NULL,
	"result_sessions" integer DEFAULT 0 NOT NULL,
	"next_issue_sessions" integer DEFAULT 0 NOT NULL,
	"second_vote_sessions" integer DEFAULT 0 NOT NULL,
	"exhausted_sessions" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_funnel_metrics_v2_pk" PRIMARY KEY("metric_date","source","medium","entry_surface","audience_segment","device_segment")
);
--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD COLUMN "entry_surface" varchar(24) DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD COLUMN "audience_segment" varchar(16) DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD COLUMN "device_segment" varchar(16) DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD COLUMN "traffic_class" varchar(16) DEFAULT 'UNCLASSIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_context_check" CHECK ("analytics_sessions"."entry_surface" in ('HOME', 'EXTERNAL', 'DIRECT_ISSUE', 'NATIVE', 'UNKNOWN')
        and "analytics_sessions"."audience_segment" in ('GUEST', 'MEMBER', 'UNKNOWN')
        and "analytics_sessions"."device_segment" in ('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN')
        and "analytics_sessions"."traffic_class" in ('PRODUCT', 'TEST', 'OPERATOR', 'BOT', 'UNCLASSIFIED'));