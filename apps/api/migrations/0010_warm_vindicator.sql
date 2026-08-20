CREATE TABLE "interest_profiles" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"onboarding_state" varchar(24) DEFAULT 'NOT_STARTED' NOT NULL,
	"taxonomy_version" varchar(32) NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_profiles_onboarding_state_check" CHECK ("interest_profiles"."onboarding_state" in ('NOT_STARTED', 'COMPLETED', 'SKIPPED', 'RESET')),
	CONSTRAINT "interest_profiles_positive_version_check" CHECK ("interest_profiles"."profile_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "subject_interests" (
	"subject_id" uuid NOT NULL,
	"card_code" varchar(32) NOT NULL,
	"source" varchar(16) DEFAULT 'EXPLICIT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_interests_pk" PRIMARY KEY("subject_id","card_code"),
	CONSTRAINT "subject_interests_source_check" CHECK ("subject_interests"."source" = 'EXPLICIT')
);
--> statement-breakpoint
ALTER TABLE "interest_profiles" ADD CONSTRAINT "interest_profiles_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_interests" ADD CONSTRAINT "subject_interests_subject_id_interest_profiles_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."interest_profiles"("subject_id") ON DELETE cascade ON UPDATE no action;