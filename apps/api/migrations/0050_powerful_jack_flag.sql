CREATE TABLE "moderation_reviewer_assist_reviews" (
	"moderation_reviewer_assist_review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderation_case_id" uuid NOT NULL,
	"operator_member_id" uuid NOT NULL,
	"provisional_label" varchar(24),
	"provisional_rationale" text,
	"ai_revealed_at" timestamp with time zone,
	"recommendation_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"final_action" varchar(48),
	"agreement" varchar(24),
	"override_direction" varchar(64),
	"reason" text,
	"review_duration_seconds" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_reviewer_assist_case_unique" UNIQUE("moderation_case_id"),
	CONSTRAINT "moderation_reviewer_assist_provisional_label_check" CHECK ("moderation_reviewer_assist_reviews"."provisional_label" is null or "moderation_reviewer_assist_reviews"."provisional_label" in ('ALLOW', 'REVIEW', 'BLOCK', 'ABSTAIN')),
	CONSTRAINT "moderation_reviewer_assist_agreement_check" CHECK ("moderation_reviewer_assist_reviews"."agreement" is null or "moderation_reviewer_assist_reviews"."agreement" in ('AGREE', 'OVERRIDE', 'NO_RECOMMENDATION')),
	CONSTRAINT "moderation_reviewer_assist_duration_check" CHECK ("moderation_reviewer_assist_reviews"."review_duration_seconds" is null or "moderation_reviewer_assist_reviews"."review_duration_seconds" >= 0),
	CONSTRAINT "moderation_reviewer_assist_completion_check" CHECK (("moderation_reviewer_assist_reviews"."completed_at" is null and "moderation_reviewer_assist_reviews"."final_action" is null and "moderation_reviewer_assist_reviews"."agreement" is null)
        or ("moderation_reviewer_assist_reviews"."completed_at" is not null and "moderation_reviewer_assist_reviews"."final_action" is not null and "moderation_reviewer_assist_reviews"."agreement" is not null and "moderation_reviewer_assist_reviews"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "moderation_reviewer_assist_reviews" ADD CONSTRAINT "moderation_reviewer_assist_reviews_moderation_case_id_moderation_cases_moderation_case_id_fk" FOREIGN KEY ("moderation_case_id") REFERENCES "public"."moderation_cases"("moderation_case_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reviewer_assist_reviews" ADD CONSTRAINT "moderation_reviewer_assist_reviews_operator_member_id_members_member_id_fk" FOREIGN KEY ("operator_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_reviewer_assist_operator_started_idx" ON "moderation_reviewer_assist_reviews" USING btree ("operator_member_id","started_at");