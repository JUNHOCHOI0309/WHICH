import { createHash } from "node:crypto";

import type { Database } from "./client.js";
import { issueChoices, issues, issueVersions } from "./schema/index.js";

type DevelopmentChoice = {
  id: string;
  code: "A" | "B";
  label: string;
};

type DevelopmentIssue = {
  id: string;
  version: number;
  question: string;
  context: string;
  publishedAt: Date;
  voteOpenAt: Date;
  categoryCode: string;
  choices: readonly [DevelopmentChoice, DevelopmentChoice];
};

export const DEVELOPMENT_ISSUES = Object.freeze([
  {
    id: "10000000-0000-4000-8000-000000000001",
    version: 1,
    question: "집중할 때 음악을 듣는 편인가요?",
    context: "일하거나 공부할 때의 평소 습관을 떠올리고 더 가까운 쪽을 골라주세요.",
    publishedAt: new Date("2026-08-17T00:00:00.000Z"),
    voteOpenAt: new Date("2026-01-01T00:00:00.000Z"),
    categoryCode: "DAILY_LIFE",
    choices: [
      {
        id: "10000000-0000-4000-8000-000000000101",
        code: "A",
        label: "듣는 편이다",
      },
      {
        id: "10000000-0000-4000-8000-000000000102",
        code: "B",
        label: "듣지 않는 편이다",
      },
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    version: 1,
    question: "약속 없는 휴일에는 밖으로 나가는 편인가요?",
    context: "완전히 자유로운 하루가 생겼을 때 더 자연스러운 쪽을 골라주세요.",
    publishedAt: new Date("2026-08-17T01:00:00.000Z"),
    voteOpenAt: new Date("2026-01-01T00:00:00.000Z"),
    categoryCode: "DAILY_LIFE",
    choices: [
      {
        id: "10000000-0000-4000-8000-000000000201",
        code: "A",
        label: "일단 나간다",
      },
      {
        id: "10000000-0000-4000-8000-000000000202",
        code: "B",
        label: "집에서 쉰다",
      },
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    version: 1,
    question: "여행은 미리 계획하는 편인가요?",
    context: "숙소부터 동선까지 준비하는 쪽과 현장에서 정하는 쪽 중 골라주세요.",
    publishedAt: new Date("2026-08-17T02:00:00.000Z"),
    voteOpenAt: new Date("2026-01-01T00:00:00.000Z"),
    categoryCode: "TRAVEL",
    choices: [
      {
        id: "10000000-0000-4000-8000-000000000301",
        code: "A",
        label: "미리 계획한다",
      },
      {
        id: "10000000-0000-4000-8000-000000000302",
        code: "B",
        label: "가서 정한다",
      },
    ],
  },
] satisfies readonly DevelopmentIssue[]);

export const DEVELOPMENT_ISSUE = DEVELOPMENT_ISSUES[0]!;

function contentHash(issue: DevelopmentIssue) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        question: issue.question,
        context: issue.context,
        choices: issue.choices,
      }),
    )
    .digest("hex");
}

export function assertDevelopmentSeedAllowed(environment: string) {
  if (environment === "production") {
    throw new Error("Development seed is disabled in production.");
  }
}

export async function seedDevelopmentIssues(database: Database["db"]) {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(issues)
      .values(
        DEVELOPMENT_ISSUES.map((issue) => ({
          id: issue.id,
          lifecycle: "PUBLISHED" as const,
          visibility: "VISIBLE" as const,
          participation: "VOTING_OPEN" as const,
          resultVisibility: "PRE_VOTE_HIDDEN" as const,
          feedEligibility: "ELIGIBLE" as const,
          riskLevel: "LOW" as const,
          isPolitical: false,
          voteOpenAt: issue.voteOpenAt,
        })),
      )
      .onConflictDoNothing();

    await transaction
      .insert(issueVersions)
      .values(
        DEVELOPMENT_ISSUES.map((issue) => ({
          issueId: issue.id,
          version: issue.version,
          question: issue.question,
          context: issue.context,
          contentHash: contentHash(issue),
          primaryCategoryCode: issue.categoryCode,
          experienceModeCode: "PERSONAL_PREFERENCE",
          taxonomyVersion: "v1",
          publishedAt: issue.publishedAt,
        })),
      )
      .onConflictDoNothing();

    await transaction
      .insert(issueChoices)
      .values(
        DEVELOPMENT_ISSUES.flatMap((issue) =>
          issue.choices.map((choice) => ({
            id: choice.id,
            issueId: issue.id,
            issueVersion: issue.version,
            code: choice.code,
            label: choice.label,
          })),
        ),
      )
      .onConflictDoNothing();
  });

  return DEVELOPMENT_ISSUES;
}
