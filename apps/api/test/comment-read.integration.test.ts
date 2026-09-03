import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  commentReactions,
  comments,
  issueChoices,
  issues,
  issueVersions,
  members,
  operatorAccessGrants,
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
  visibility?: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "HIDDEN" | "REMOVED_BY_AUTHOR";
  integrityState?: "NORMAL" | "REVIEW";
  threadState?: "OPEN" | "LOCKED";
  deletedAt?: Date;
  parentCommentId?: string;
  threadRootCommentId?: string;
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
    parentCommentId: command.parentCommentId,
    threadRootCommentId: command.threadRootCommentId,
    createdAt: command.createdAt,
  });
  return id;
}

async function addHelpfulReactions(commentId: string, total: number) {
  for (let index = 0; index < total; index += 1) {
    const subjectId = randomUUID();
    await database.db.insert(voterSubjects).values({
      id: subjectId,
      kind: "GUEST",
      anonymousSubjectId: randomUUID(),
    });
    await database.db.insert(commentReactions).values({
      commentId,
      subjectId,
      originSubjectId: subjectId,
      code: "HELPFUL",
      active: true,
    });
  }
}

async function grantCommentAuthorOperatorAccess(commentId: string) {
  const memberId = randomUUID();
  await database.db.insert(members).values({
    id: memberId,
    displayName: "운영자",
  });
  const [author] = await database.db
    .select({ subjectId: voterSubjects.id })
    .from(comments)
    .innerJoin(voterSubjects, eq(voterSubjects.id, comments.authorSubjectId))
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!author) throw new Error("Comment author is missing.");
  await database.db
    .update(voterSubjects)
    .set({ kind: "MEMBER", userId: memberId, anonymousSubjectId: null })
    .where(eq(voterSubjects.id, author.subjectId));
  await database.db.insert(operatorAccessGrants).values({
    memberId,
    grantedBy: "comment-read-test",
  });
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
      totalCount: number;
    }>();
    expect(firstResponse.statusCode).toBe(200);
    expect(first.items.map((item) => item.id)).toEqual([newestA, middleB]);
    expect(first.totalCount).toBe(3);

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
    const sidePage = sideResponse.json<{
      items: Array<{ choice: string }>;
      totalCount: number;
    }>();
    expect(sidePage.items.map((item) => item.choice)).toEqual(["A", "A"]);
    expect(sidePage.totalCount).toBe(3);
  });

  it("marks active operators as WHICH managers in public Comment authors", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const managerComment = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "manager comment",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
    });
    await grantCommentAuthorOperatorAccess(managerComment);

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: managerComment,
          author: { displayName: "WHICH_MANAGER", isManager: true },
        },
      ],
    });
  });

  it("sorts public Comments by helpful reactions with a stable cursor and returns the full count", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const newest = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "newest",
      createdAt: new Date("2026-08-18T03:00:00.000Z"),
    });
    const mostHelpful = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "most helpful",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
    });
    const secondHelpful = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "second helpful",
      createdAt: new Date("2026-08-18T01:00:00.000Z"),
    });
    await addHelpfulReactions(mostHelpful, 4);
    await addHelpfulReactions(secondHelpful, 2);

    const firstResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?sort=HELPFUL&limit=2`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    const first = firstResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
      totalCount: number;
    }>();

    expect(firstResponse.statusCode).toBe(200);
    expect(first.items.map((comment) => comment.id)).toEqual([mostHelpful, secondHelpful]);
    expect(first.totalCount).toBe(3);
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?sort=HELPFUL&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    expect(secondResponse.json<{ items: Array<{ id: string }> }>().items).toEqual([
      expect.objectContaining({ id: newest }),
    ]);

    const sideResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=A`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    expect(sideResponse.json<{ totalCount: number }>().totalCount).toBe(3);
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
        author: { displayName: "A 작성자", avatarUrl: null, isManager: false },
        body: "locked but public",
        visibility: "VISIBLE",
        threadState: "LOCKED",
        createdAt: "2026-08-18T03:00:00.000Z",
        editedAt: null,
        parentCommentId: null,
        reactions: { helpfulCount: 0, dislikeCount: 0, viewerReaction: null },
        reports: { viewerReported: false, canReport: true },
        permissions: { canEdit: false, canDelete: false },
        replies: [],
      },
    ]);
  });

  it("keeps author-removed ancestors as tombstones while visible replies remain", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const removedRoot = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "[작성자가 삭제한 댓글]",
      createdAt: new Date("2026-08-18T03:00:00.000Z"),
      visibility: "REMOVED_BY_AUTHOR",
      deletedAt: new Date("2026-08-18T04:00:00.000Z"),
    });
    const removedReply = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "[작성자가 삭제한 댓글]",
      createdAt: new Date("2026-08-18T03:10:00.000Z"),
      visibility: "REMOVED_BY_AUTHOR",
      deletedAt: new Date("2026-08-18T04:10:00.000Z"),
      parentCommentId: removedRoot,
      threadRootCommentId: removedRoot,
    });
    const visibleReply = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "남아 있어야 하는 답글",
      createdAt: new Date("2026-08-18T03:20:00.000Z"),
      parentCommentId: removedReply,
      threadRootCommentId: removedRoot,
    });
    await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "[작성자가 삭제한 댓글]",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
      visibility: "REMOVED_BY_AUTHOR",
      deletedAt: new Date("2026-08-18T04:20:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    const page = response.json<{
      totalCount: number;
      items: Array<{
        id: string;
        visibility: string;
        author: { displayName: string; avatarUrl: string | null; isManager: boolean };
        reports: { canReport: boolean };
        permissions: { canEdit: boolean; canDelete: boolean };
        replies: Array<{ id: string; visibility: string; replies: Array<{ id: string }> }>;
      }>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: removedRoot,
      visibility: "REMOVED_BY_AUTHOR",
      author: { displayName: "삭제된 댓글", avatarUrl: null, isManager: false },
      reports: { canReport: false },
      permissions: { canEdit: false, canDelete: false },
      replies: [
        {
          id: removedReply,
          visibility: "REMOVED_BY_AUTHOR",
          replies: [{ id: visibleReply }],
        },
      ],
    });
  });

  it("returns visible A/B highlights ordered by helpful reactions and recency", async () => {
    const issue = await createIssue();
    const reader = await createAcceptedVote({ issueId: issue.issueId, choiceId: issue.choiceAId });
    const newestA = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "newest A",
      createdAt: new Date("2026-08-18T04:00:00.000Z"),
    });
    const helpfulA = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "helpful A",
      createdAt: new Date("2026-08-18T03:00:00.000Z"),
    });
    const helpfulB = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      choice: "B",
      body: "helpful B",
      createdAt: new Date("2026-08-18T02:00:00.000Z"),
    });
    const collapsedA = await createComment({
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      choice: "A",
      body: "collapsed A",
      createdAt: new Date("2026-08-18T05:00:00.000Z"),
      visibility: "COLLAPSED",
    });
    await addHelpfulReactions(helpfulA, 3);
    await addHelpfulReactions(helpfulB, 2);
    await addHelpfulReactions(collapsedA, 5);

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comment-highlights?limitPerSide=5`,
      headers: { "x-anonymous-subject-id": reader.anonymousSubjectId },
    });
    const highlights = response.json<{
      A: Array<{ id: string; reactions: { helpfulCount: number } }>;
      B: Array<{ id: string; reactions: { helpfulCount: number } }>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(highlights.A.map((comment) => comment.id)).toEqual([helpfulA, newestA]);
    expect(highlights.A[0]?.reactions.helpfulCount).toBe(3);
    expect(highlights.B.map((comment) => comment.id)).toEqual([helpfulB]);
    expect(highlights.B[0]?.reactions.helpfulCount).toBe(2);
    expect(highlights.A.map((comment) => comment.id)).not.toContain(collapsedA);
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
