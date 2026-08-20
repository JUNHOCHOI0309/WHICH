CREATE TABLE "analytics_daily_metrics" (
	"metric_date" date NOT NULL,
	"source" varchar(32) NOT NULL,
	"medium" varchar(32) NOT NULL,
	"campaign" varchar(64) NOT NULL,
	"content" varchar(96) NOT NULL,
	"qualified_sessions" integer DEFAULT 0 NOT NULL,
	"accepted_vote_sessions" integer DEFAULT 0 NOT NULL,
	"accepted_votes" integer DEFAULT 0 NOT NULL,
	"second_vote_sessions" integer DEFAULT 0 NOT NULL,
	"result_views" integer DEFAULT 0 NOT NULL,
	"next_issue_opens" integer DEFAULT 0 NOT NULL,
	"next_issue_exhausted" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_metrics_pk" PRIMARY KEY("metric_date","source","medium","campaign","content")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"analytics_session_id" uuid NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_type_check" CHECK ("analytics_events"."event_type" in ('ISSUE_VIEWABLE_IMPRESSION', 'VOTE_SUBMIT', 'RESULT_VIEW', 'NEXT_ISSUE_OPEN', 'NEXT_ISSUE_EXHAUSTED'))
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"analytics_session_id" uuid PRIMARY KEY NOT NULL,
	"attribution_source" varchar(32),
	"attribution_medium" varchar(32),
	"attribution_campaign" varchar(64),
	"attribution_content" varchar(96),
	"attribution_captured_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_sessions_window_check" CHECK ("analytics_sessions"."last_activity_at" >= "analytics_sessions"."started_at" and "analytics_sessions"."expires_at" > "analytics_sessions"."last_activity_at")
);
--> statement-breakpoint
ALTER TABLE "vote_attempts" ADD COLUMN "analytics_session_id" uuid;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "analytics_session_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_analytics_session_id_analytics_sessions_analytics_session_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("analytics_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_session_occurred_idx" ON "analytics_events" USING btree ("analytics_session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_type_occurred_idx" ON "analytics_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_last_activity_idx" ON "analytics_sessions" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_attribution_idx" ON "analytics_sessions" USING btree ("attribution_source","attribution_medium");--> statement-breakpoint
ALTER TABLE "vote_attempts" ADD CONSTRAINT "vote_attempts_analytics_session_id_analytics_sessions_analytics_session_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("analytics_session_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_analytics_session_id_analytics_sessions_analytics_session_id_fk" FOREIGN KEY ("analytics_session_id") REFERENCES "public"."analytics_sessions"("analytics_session_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "votes_analytics_session_accepted_idx" ON "votes" USING btree ("analytics_session_id","accepted_at");
