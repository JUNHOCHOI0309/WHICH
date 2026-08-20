CREATE TABLE "issue_interest_cards" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"card_code" varchar(32) NOT NULL,
	"taxonomy_version" varchar(32) NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_interest_cards_pk" PRIMARY KEY("issue_id","issue_version","card_code"),
	CONSTRAINT "issue_interest_cards_weight_check" CHECK ("issue_interest_cards"."weight" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "recommendation_items" (
	"recommendation_request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"score" integer NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"matched_card_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_items_pk" PRIMARY KEY("recommendation_request_id","position"),
	CONSTRAINT "recommendation_items_request_issue_unique" UNIQUE("recommendation_request_id","issue_id"),
	CONSTRAINT "recommendation_items_position_check" CHECK ("recommendation_items"."position" > 0),
	CONSTRAINT "recommendation_items_score_check" CHECK ("recommendation_items"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recommendation_requests" (
	"recommendation_request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid,
	"ranking_version" varchar(32) NOT NULL,
	"ranking_mode" varchar(24) NOT NULL,
	"reason_code" varchar(32) NOT NULL,
	"profile_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_requests_mode_check" CHECK ("recommendation_requests"."ranking_mode" in ('PERSONALIZED', 'RECENCY')),
	CONSTRAINT "recommendation_requests_profile_version_check" CHECK ("recommendation_requests"."profile_version" is null or "recommendation_requests"."profile_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "issue_interest_cards" ADD CONSTRAINT "issue_interest_cards_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_recommendation_request_id_recommendation_requests_recommendation_request_id_fk" FOREIGN KEY ("recommendation_request_id") REFERENCES "public"."recommendation_requests"("recommendation_request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_requests" ADD CONSTRAINT "recommendation_requests_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_interest_cards_card_idx" ON "issue_interest_cards" USING btree ("card_code","issue_id");--> statement-breakpoint
CREATE INDEX "recommendation_requests_subject_created_idx" ON "recommendation_requests" USING btree ("subject_id","created_at");
--> statement-breakpoint
INSERT INTO "issue_interest_cards" (
	"issue_id",
	"issue_version",
	"card_code",
	"taxonomy_version",
	"weight"
)
SELECT
	mapping.issue_id::uuid,
	mapping.issue_version,
	mapping.card_code,
	'interest_cards_v1',
	100
FROM (
	VALUES
		('591f2e90-996a-50c5-af46-967dd0793000', 1, 'FOOD'),
		('8c092a45-c446-50f3-b1ac-ac9a018b9105', 1, 'TRAVEL'),
		('8c092a45-c446-50f3-b1ac-ac9a018b9105', 1, 'FOOD'),
		('93831fba-b70f-598a-88f6-92eb4f70df9c', 1, 'DAILY_LIFE'),
		('d52dace5-486c-5e34-bb73-5a0b5a779c98', 1, 'HOBBY'),
		('add8d2eb-a121-5a75-bd02-f7da2a18aae4', 1, 'DAILY_LIFE'),
		('add8d2eb-a121-5a75-bd02-f7da2a18aae4', 1, 'RELATIONSHIP'),
		('ed5d3d01-b902-511f-b1e8-64e5ade5ee8a', 1, 'RELATIONSHIP'),
		('5b3b767c-2944-59b6-8f2b-174353e38993', 1, 'RELATIONSHIP'),
		('5b3b767c-2944-59b6-8f2b-174353e38993', 1, 'ECONOMY_CONSUMPTION'),
		('2806555a-b674-5f47-afdd-4e73d10d2678', 1, 'MOVIE_DRAMA'),
		('05ed42ff-e88f-537e-82b0-43bf0daa64e1', 1, 'GAME'),
		('ce976502-9409-56a2-b975-94c913a20fcf', 1, 'TECH'),
		('c63532bd-1c4f-5682-af0f-d1714be24d13', 1, 'SPORTS'),
		('c63532bd-1c4f-5682-af0f-d1714be24d13', 1, 'HOBBY'),
		('b426e1c7-9932-54c8-b614-f9dfadc9f640', 1, 'SPORTS')
) AS mapping(issue_id, issue_version, card_code)
INNER JOIN "issue_versions"
	ON "issue_versions"."issue_id" = mapping.issue_id::uuid
	AND "issue_versions"."issue_version" = mapping.issue_version
ON CONFLICT DO NOTHING;
