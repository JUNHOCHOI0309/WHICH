CREATE TABLE "operator_poll_sync_runs" (
	"day" varchar(10) PRIMARY KEY NOT NULL,
	"task_id" varchar(200) NOT NULL,
	"status" varchar(16) NOT NULL,
	"phase" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	CONSTRAINT "operator_poll_sync_runs_status_check" CHECK ("operator_poll_sync_runs"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "operator_poll_sync_runs_phase_check" CHECK ("operator_poll_sync_runs"."phase" in ('REQUESTING', 'ACCEPTED', 'IMPORTED'))
);
