CREATE TABLE "issue_recommendations" (
	"issue_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_recommendations_pk" PRIMARY KEY("issue_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "issue_recommendations" ADD CONSTRAINT "issue_recommendations_issue_id_issues_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("issue_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recommendations" ADD CONSTRAINT "issue_recommendations_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_recommendations_active_issue_idx" ON "issue_recommendations" USING btree ("issue_id") WHERE "issue_recommendations"."active" = true;