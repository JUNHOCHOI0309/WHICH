import { createHash } from "node:crypto";

import type { Database } from "./client.js";
import { issueChoices, issues, issueVersions } from "./schema/index.js";

const question = "집중할 때 음악을 듣는 편인가요?";
const context = "일하거나 공부할 때의 평소 습관을 떠올리고 더 가까운 쪽을 골라주세요.";

export const DEVELOPMENT_ISSUE = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  version: 1,
  question,
  context,
  publishedAt: new Date("2026-08-18T00:00:00.000Z"),
  voteOpenAt: new Date("2026-01-01T00:00:00.000Z"),
  choices: Object.freeze([
    {
      id: "10000000-0000-4000-8000-000000000101",
      code: "A" as const,
      label: "듣는 편이다",
    },
    {
      id: "10000000-0000-4000-8000-000000000102",
      code: "B" as const,
      label: "듣지 않는 편이다",
    },
  ]),
});

const contentHash = createHash("sha256")
  .update(
    JSON.stringify({
      question,
      context,
      choices: DEVELOPMENT_ISSUE.choices,
    }),
  )
  .digest("hex");

export function assertDevelopmentSeedAllowed(environment: string) {
  if (environment === "production") {
    throw new Error("Development seed is disabled in production.");
  }
}

export async function seedDevelopmentIssues(database: Database["db"]) {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(issues)
      .values({
        id: DEVELOPMENT_ISSUE.id,
        lifecycle: "PUBLISHED",
        visibility: "VISIBLE",
        participation: "VOTING_OPEN",
        resultVisibility: "PRE_VOTE_HIDDEN",
        feedEligibility: "ELIGIBLE",
        riskLevel: "LOW",
        isPolitical: false,
        voteOpenAt: DEVELOPMENT_ISSUE.voteOpenAt,
      })
      .onConflictDoNothing();

    await transaction
      .insert(issueVersions)
      .values({
        issueId: DEVELOPMENT_ISSUE.id,
        version: DEVELOPMENT_ISSUE.version,
        question: DEVELOPMENT_ISSUE.question,
        context: DEVELOPMENT_ISSUE.context,
        contentHash,
        primaryCategoryCode: "DAILY_LIFE",
        experienceModeCode: "PERSONAL_PREFERENCE",
        taxonomyVersion: "v1",
        publishedAt: DEVELOPMENT_ISSUE.publishedAt,
      })
      .onConflictDoNothing();

    await transaction
      .insert(issueChoices)
      .values(
        DEVELOPMENT_ISSUE.choices.map((choice) => ({
          id: choice.id,
          issueId: DEVELOPMENT_ISSUE.id,
          issueVersion: DEVELOPMENT_ISSUE.version,
          code: choice.code,
          label: choice.label,
        })),
      )
      .onConflictDoNothing();
  });

  return DEVELOPMENT_ISSUE;
}
