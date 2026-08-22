CREATE TYPE "public"."profile_visibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TABLE "issue_authors" (
	"issue_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_authors_pk" PRIMARY KEY("issue_id")
);
--> statement-breakpoint
CREATE TABLE "member_profiles" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"handle" varchar(30) NOT NULL,
	"bio" varchar(160),
	"visibility" "profile_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_authors" ADD CONSTRAINT "issue_authors_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_authors" ADD CONSTRAINT "issue_authors_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_authors_member_assigned_idx" ON "issue_authors" USING btree ("member_id","assigned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_handle_lower_unique" ON "member_profiles" USING btree (lower("handle"));