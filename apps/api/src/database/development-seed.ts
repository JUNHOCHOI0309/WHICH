import { createHash } from "node:crypto";

import type { Database } from "./client.js";
import {
  comments,
  issueChoices,
  issues,
  issueVersions,
  voterSubjects,
  voteAttempts,
  votes,
} from "./schema/index.js";

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

export const DEVELOPMENT_COMMENTS = Object.freeze([
  {
    id: "30000000-0000-4000-8000-000000000001",
    issueIndex: 0,
    choice: "A" as const,
    authorDisplayName: "집중하는 파도",
    body: "가사가 없는 음악은 주변 소음을 덮어줘서 한 가지 일에 오래 집중하기 좋아요.",
    createdAt: new Date("2026-08-17T03:00:00.000Z"),
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    issueIndex: 0,
    choice: "B" as const,
    authorDisplayName: "조용한 책상",
    body: "작은 리듬에도 생각이 끊기는 편이라 중요한 일을 할 때는 조용한 환경을 골라요.",
    createdAt: new Date("2026-08-17T03:01:00.000Z"),
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    issueIndex: 1,
    choice: "A" as const,
    authorDisplayName: "동네 산책자",
    body: "멀리 가지 않더라도 밖에 나가 햇빛을 보고 걸으면 휴일이 더 길게 느껴져요.",
    createdAt: new Date("2026-08-17T03:02:00.000Z"),
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    issueIndex: 1,
    choice: "B" as const,
    authorDisplayName: "충전 중",
    body: "평일에 이동이 많아서 약속 없는 날만큼은 집에서 쉬어야 다음 주를 버틸 수 있어요.",
    createdAt: new Date("2026-08-17T03:03:00.000Z"),
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    issueIndex: 2,
    choice: "A" as const,
    authorDisplayName: "체크리스트 여행자",
    body: "숙소와 꼭 가고 싶은 곳만 먼저 정해두면 현지에서 선택할 여유가 오히려 커져요.",
    createdAt: new Date("2026-08-17T03:04:00.000Z"),
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    issueIndex: 2,
    choice: "B" as const,
    authorDisplayName: "느슨한 지도",
    body: "날씨와 그날 기분에 따라 움직일 때 예상하지 못한 장소를 만나는 재미가 있어요.",
    createdAt: new Date("2026-08-17T03:05:00.000Z"),
  },
]);

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

    await transaction
      .insert(voterSubjects)
      .values(
        DEVELOPMENT_COMMENTS.map((comment, index) => ({
          id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          kind: "MEMBER" as const,
          userId: `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        })),
      )
      .onConflictDoNothing();

    await transaction
      .insert(voteAttempts)
      .values(
        DEVELOPMENT_COMMENTS.map((comment, index) => {
          const issue = DEVELOPMENT_ISSUES[comment.issueIndex]!;
          const choice = issue.choices.find((candidate) => candidate.code === comment.choice)!;
          const id = `22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
          return {
            id,
            idempotencyKey: `development-comment-author-${index + 1}`,
            issueId: issue.id,
            issueVersion: issue.version,
            choiceId: choice.id,
            subjectId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            requestState: "COMPLETED" as const,
            requestFingerprint: "development-seed".padEnd(64, "0"),
            completedAt: comment.createdAt,
          };
        }),
      )
      .onConflictDoNothing();

    await transaction
      .insert(votes)
      .values(
        DEVELOPMENT_COMMENTS.map((comment, index) => {
          const issue = DEVELOPMENT_ISSUES[comment.issueIndex]!;
          const choice = issue.choices.find((candidate) => candidate.code === comment.choice)!;
          return {
            id: `23000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            voteAttemptId: `22000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            issueId: issue.id,
            issueVersion: issue.version,
            choiceId: choice.id,
            subjectId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            integrityState: "ACCEPTED" as const,
            reasonCode: "DEVELOPMENT_FIXTURE",
            userTier: "MEMBER",
            accountAssurance: "ACCOUNT",
            uniquenessAssurance: "ACCOUNT",
            issueRiskLevel: "LOW" as const,
            eligibilityPolicyVersion: "development-v1",
            integrityPolicyVersion: "development-v1",
            isTestSubject: true,
            acceptedAt: comment.createdAt,
          };
        }),
      )
      .onConflictDoNothing();

    await transaction
      .insert(comments)
      .values(
        DEVELOPMENT_COMMENTS.map((comment, index) => {
          const issue = DEVELOPMENT_ISSUES[comment.issueIndex]!;
          return {
            id: comment.id,
            issueId: issue.id,
            issueVersion: issue.version,
            authorSubjectId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            acceptedVoteId: `23000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            choice: comment.choice,
            authorDisplayName: comment.authorDisplayName,
            body: comment.body,
            publicationState: "PUBLISHED" as const,
            visibility: "VISIBLE" as const,
            integrityState: "NORMAL" as const,
            createdAt: comment.createdAt,
          };
        }),
      )
      .onConflictDoNothing();
  });

  return DEVELOPMENT_ISSUES;
}
