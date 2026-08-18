import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  comments,
  issueChoices,
  issues,
  issueVersions,
  voterSubjects,
  voteAttempts,
  votes,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createIssue() {
  const issueId = randomUUID();
  const choiceAId = randomUUID();
  const choiceBId = randomUUID();

  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "Which reason fits?",
    contentHash: "c".repeat(64),
    primaryCategoryCode: "TEST",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt: new Date(),
  });
  await database.db.insert(issueChoices).values([
    { id: choiceAId, issueId, issueVersion: 1, code: "A", label: "A" },
    { id: choiceBId, issueId, issueVersion: 1, code: "B", label: "B" },
  ]);

  return { issueId, choiceAId, choiceBId };
}

async function createAcceptedVote(command: {
  issueId: string;
  choiceId: string;
  anonymousSubjectId?: string;
}) {
  const subjectId = randomUUID();
  const anonymousSubjectId = command.anonymousSubjectId ?? randomUUID();
  const attemptId = randomUUID();
  const voteId = randomUUID();

  await database.db.insert(voterSubjects).values({
    id: subjectId,
    kind: "GUEST",
    anonymousSubjectId,
  });
  await database.db.insert(voteAttempts).values({
    id: attemptId,
    idempotencyKey: attemptId,
    issueId: command.issueId,
    issueVersion: 1,
    choiceId: command.choiceId,
    subjectId,
    requestState: "COMPLETED",
    requestFingerprint: "f".repeat(64),
    completedAt: new Date(),
  });
  await database.db.insert(votes).values({
    id: voteId,
    voteAttemptId: attemptId,
    issueId: command.issueId,
    issueVersion: 1,
    choiceId: command.choiceId,
    subjectId,
    integrityState: "ACCEPTED",
    reasonCode: "TEST",
    userTier: "GUEST",
    accountAssurance: "ANONYMOUS",
    uniquenessAssurance: "TEST",
    issueRiskLevel: "LOW",
    eligibilityPolicyVersion: "test-v1",
    integrityPolicyVersion: "test-v1",
    acceptedAt: new Date(),
  });

  return { subjectId, anonymousSubjectId, voteId };
}

async function createComment(command: {
  issueId: string;
  choiceId: string;
  choice: "A" | "B";
  body: string;
  createdAt: Date;
  publicationState?: "PUBLISHED" | "PENDING_HUMAN_REVIEW";
  visibility?: "VISIBLE" | "HIDDEN" | "REMOVED_BY_AUTHOR";
  integrityState?: "NORMAL" | "REVIEW";
  threadState?: "OPEN" | "LOCKED";
  deletedAt?: Date;
}) {
  const author = await createAcceptedVote({ issueId: command.issueId, choiceId: command.choiceId });
  const id = randomUUID();
  await database.db.insert(comments).values({
    id,
    issueId: command.issueId,
    issueVersion: 1,
    authorSubjectId: author.subjectId,
    acceptedVoteId: author.voteId,
    choice: command.choice,
    authorDisplayName: `${command.choice} 작성자`,
    body: command.body,
    publicationState: command.publicationState ?? "PUBLISHED",
    visibility: command.visibility ?? "VISIBLE",
    integrityState: command.integrityState ?? "NORMAL",
    threadState: command.threadState ?? "OPEN",
    deletedAt: command.deletedAt,
    createdAt: command.createdAt,
  });
  return id;
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  app = await buildApp(getConfig({ NODE_ENV: "test" }), {
    ...database,
    issueReader: createIssueReadService(database.db),
    guestVotes: createGuestVoteService(database.db),
    commentReader: createCommentReadService(database.db),
    memberIdentity: createMemberIdentityService(database.db, {
      sessionTtlSeconds: 3_600,
      allowDevelopmentProvider: true,
    }),
  });
}, 30_000);

afterAll(async () => {
  await app.close();
  await dropDatabase();
});

describe("Guest Comment read API", () => {
  it("requires an accepted Vote before exposing Comments", async () => {
    const issue = await createIssue();
    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "x-anonymous-subject-id": randomUUID() },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "VOTE_REQUIRED" });
  });

  it("filters A/B and paginates newest Comments without duplication", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const newestA = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "newest A",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
    });
    const middleB = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "middle B",
      createdAt: new Date("2026-08-18T01:00:00.000Z"),
    });
    const oldestA = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "oldest A",
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
    });

    const firstResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?limit=2`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    const first = firstResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(firstResponse.statusCode).toBe(200);
    expect(first.items.map((item) => item.id)).toEqual([newestA, middleB]);

    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    expect(secondResponse.json<{ items: Array<{ id: string }> }>().items).toEqual([
      expect.objectContaining({ id: oldestA }),
    ]);

    const sideResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=A`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    expect(
      sideResponse.json<{ items: Array<{ choice: string }> }>().items.map((item) => item.choice),
    ).toEqual(["A", "A"]);
  });

  it("hides non-public Comments while keeping locked Threads readable", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const locked = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "locked but public",
      createdAt: new Date("2026-08-18T03:00:00.000Z"),
      threadState: "LOCKED",
    });
    await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "pending",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
      publicationState: "PENDING_HUMAN_REVIEW",
    });
    await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "hidden",
      createdAt: new Date("2026-08-18T01:00:00.000Z"),
      visibility: "HIDDEN",
    });
    await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "deleted",
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
      visibility: "REMOVED_BY_AUTHOR",
      deletedAt: new Date("2026-08-18T00:30:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    const page = response.json<{ items: Array<{ id: string; threadState: string }> }>();

    expect(response.statusCode).toBe(200);
    expect(page.items).toEqual([
      {
        id: locked,
        choice: "A",
        author: { displayName: "A 작성자" },
        body: "locked but public",
        threadState: "LOCKED",
        createdAt: "2026-08-18T03:00:00.000Z",
        editedAt: null,
        reactions: { helpfulCount: 0, viewerReacted: false },
      },
    ]);
  });

  it("rejects malformed cursors", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?cursor=broken`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CURSOR" });
  });
});
