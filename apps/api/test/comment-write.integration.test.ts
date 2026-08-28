import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  comments,
  commentWriteAttempts,
  issueChoices,
  issues,
  issueVersions,
  outboxEvents,
  voteAttempts,
  voterSubjects,
  votes,
} from "../src/database/schema/index.js";
import { createCommentService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "comment-write-test-secret";

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
    question: "Why did you choose it?",
    contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
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

async function createGuestVote(issueId: string, choiceId: string) {
  const guestResponse = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  const anonymousSubjectId = guestResponse.json<{ anonymousSubjectId: string }>()
    .anonymousSubjectId;
  const voteResponse = await app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/votes`,
    headers: {
      "idempotency-key": randomUUID(),
      "x-anonymous-subject-id": anonymousSubjectId,
    },
    payload: { issueVersion: 1, choiceId },
  });
  expect(voteResponse.statusCode).toBe(201);
  return anonymousSubjectId;
}

async function createSession(providerSubject: string, anonymousSubjectId?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject,
      displayName: "댓글 작성자",
      anonymousSubjectId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string; member: { id: string } }>();
}

function submitComment(
  issueId: string,
  token: string,
  idempotencyKey: string,
  body: string,
  anonymousSubjectId?: string,
  parentCommentId?: string,
) {
  return app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/comments`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": idempotencyKey,
      ...(anonymousSubjectId ? { "x-anonymous-subject-id": anonymousSubjectId } : {}),
    },
    payload: { body, ...(parentCommentId ? { parentCommentId } : {}) },
  });
}

function updateComment(commentId: string, token: string, body: string) {
  return app.inject({
    method: "PATCH",
    url: `/v1/comments/${commentId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { body },
  });
}

function deleteComment(commentId: string, token: string) {
  return app.inject({
    method: "DELETE",
    url: `/v1/comments/${commentId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const config = getConfig({ NODE_ENV: "test", INTERNAL_AUTH_SECRET: INTERNAL_SECRET });
  app = await buildApp(config, {
    ...database,
    issueReader: createIssueReadService(database.db),
    guestVotes: createGuestVoteService(database.db),
    commentReader: createCommentService(database.db),
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

describe("Member Comment write API", () => {
  it("supports login, Member Vote, Comment read, and Comment write as one flow", async () => {
    const issue = await createIssue();
    const session = await createSession("comment-member-vote-flow");
    const vote = await app.inject({
      method: "POST",
      url: `/v1/issues/${issue.issueId}/votes`,
      headers: {
        authorization: `Bearer ${session.token}`,
        "idempotency-key": randomUUID(),
      },
      payload: { issueVersion: 1, choiceId: issue.choiceAId },
    });
    expect(vote.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [], nextCursor: null, totalCount: 0 });

    const comment = await submitComment(
      issue.issueId,
      session.token,
      randomUUID(),
      "로그인 후 바로 남긴 이유",
    );
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({ comment: { choice: "A" } });

    const [storedVote] = await database.db
      .select({ userId: voterSubjects.userId, userTier: votes.userTier })
      .from(votes)
      .innerJoin(voterSubjects, eq(voterSubjects.id, votes.subjectId))
      .where(eq(votes.issueId, issue.issueId))
      .limit(1);
    expect(storedVote).toEqual({ userId: session.member.id, userTier: "MEMBER" });
  });

  it("rejects a Member Vote when the Member already owns a linked Guest Vote", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceAId);
    const session = await createSession("comment-linked-vote-deduplication", anonymousSubjectId);

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/issues/${issue.issueId}/votes`,
      headers: {
        authorization: `Bearer ${session.token}`,
        "idempotency-key": randomUUID(),
      },
      payload: { issueVersion: 1, choiceId: issue.choiceBId },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ outcome: "REJECTED_DUPLICATE", choice: "A" });
    const storedVotes = await database.db
      .select({ integrityState: votes.integrityState })
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    expect(storedVotes.filter((vote) => vote.integrityState === "ACCEPTED")).toHaveLength(1);
  });

  it("accepts the current browser's unlinked Guest Vote for an active Member", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceBId);
    const session = await createSession("comment-current-unlinked-guest");

    const list = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: {
        authorization: `Bearer ${session.token}`,
        "x-anonymous-subject-id": anonymousSubjectId,
      },
    });
    expect(list.statusCode).toBe(200);

    const comment = await submitComment(
      issue.issueId,
      session.token,
      randomUUID(),
      "기존 Guest 투표에서 이어진 이유",
      anonymousSubjectId,
    );
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({ comment: { choice: "B" } });
  });

  it("does not accept a Guest Vote linked to a different Member", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceAId);
    await createSession("comment-guest-owner", anonymousSubjectId);
    const otherSession = await createSession("comment-guest-non-owner");

    const list = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: {
        authorization: `Bearer ${otherSession.token}`,
        "x-anonymous-subject-id": anonymousSubjectId,
      },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ code: "VOTE_REQUIRED" });

    const comment = await submitComment(
      issue.issueId,
      otherSession.token,
      randomUUID(),
      "다른 회원의 투표를 사용할 수 없음",
      anonymousSubjectId,
    );
    expect(comment.statusCode).toBe(403);
    expect(comment.json()).toMatchObject({ code: "VOTE_REQUIRED" });
  });

  it("publishes from a linked Guest Vote and replays the completed idempotent response", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceBId);
    const session = await createSession("comment-linked-guest", anonymousSubjectId);
    const idempotencyKey = randomUUID();

    const first = await submitComment(
      issue.issueId,
      session.token,
      idempotencyKey,
      "  선택한 이유예요  ",
    );
    const replay = await submitComment(
      issue.issueId,
      session.token,
      idempotencyKey,
      "선택한 이유예요",
    );

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      comment: { choice: "B", author: { displayName: "댓글 작성자" }, body: "선택한 이유예요" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());

    const storedComments = await database.db
      .select({ id: comments.id, policy: comments.textPolicyVersion })
      .from(comments)
      .where(eq(comments.issueId, issue.issueId));
    const attempts = await database.db
      .select({ id: commentWriteAttempts.id })
      .from(commentWriteAttempts)
      .where(eq(commentWriteAttempts.issueId, issue.issueId));
    const events = await database.db
      .select({ type: outboxEvents.eventType })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, storedComments[0]!.id));
    expect(storedComments).toHaveLength(1);
    expect(storedComments[0]?.policy).toBe("comment-text-v1");
    expect(attempts).toHaveLength(1);
    expect(events).toEqual([{ type: "COMMENT_PUBLISHED" }]);

    const conflict = await submitComment(issue.issueId, session.token, idempotencyKey, "다른 내용");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const secondComment = await submitComment(
      issue.issueId,
      session.token,
      randomUUID(),
      "두 번째 댓글",
    );
    expect(secondComment.statusCode).toBe(201);
    expect(secondComment.json()).toMatchObject({ comment: { body: "두 번째 댓글" } });

    const allComments = await database.db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.issueId, issue.issueId));
    expect(allComments).toHaveLength(2);
  });

  it("publishes and returns replies at arbitrary nesting depths", async () => {
    const issue = await createIssue();
    const authorGuest = await createGuestVote(issue.issueId, issue.choiceAId);
    const author = await createSession(`reply-root-author-${issue.issueId}`, authorGuest);
    const rootResponse = await submitComment(
      issue.issueId,
      author.token,
      randomUUID(),
      "답글을 받을 댓글",
    );
    const rootId = rootResponse.json<{ comment: { id: string } }>().comment.id;

    const replierGuest = await createGuestVote(issue.issueId, issue.choiceBId);
    const replier = await createSession(`reply-author-${issue.issueId}`, replierGuest);
    const replyResponse = await submitComment(
      issue.issueId,
      replier.token,
      randomUUID(),
      "한 단계 답글",
      undefined,
      rootId,
    );
    expect(replyResponse.statusCode).toBe(201);
    const replyId = replyResponse.json<{ comment: { id: string } }>().comment.id;

    const nestedReply = await submitComment(
      issue.issueId,
      author.token,
      randomUUID(),
      "두 단계 답글",
      undefined,
      replyId,
    );
    expect(nestedReply.statusCode).toBe(201);
    const nestedReplyId = nestedReply.json<{ comment: { id: string } }>().comment.id;

    const deeplyNestedReply = await submitComment(
      issue.issueId,
      replier.token,
      randomUUID(),
      "세 단계 답글",
      undefined,
      nestedReplyId,
    );
    expect(deeplyNestedReply.statusCode).toBe(201);
    const deeplyNestedReplyId = deeplyNestedReply.json<{ comment: { id: string } }>().comment.id;

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: { authorization: `Bearer ${replier.token}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      items: [
        {
          id: rootId,
          parentCommentId: null,
          replies: [
            {
              id: replyId,
              parentCommentId: rootId,
              body: "한 단계 답글",
              replies: [
                {
                  id: nestedReplyId,
                  parentCommentId: replyId,
                  body: "두 단계 답글",
                  replies: [
                    {
                      id: deeplyNestedReplyId,
                      parentCommentId: nestedReplyId,
                      body: "세 단계 답글",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("prefers a direct Member Vote over a linked Guest Vote", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceAId);
    const session = await createSession("comment-direct-member", anonymousSubjectId);
    const [memberSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.userId, session.member.id))
      .limit(1);
    const attemptId = randomUUID();
    await database.db.insert(voteAttempts).values({
      id: attemptId,
      idempotencyKey: attemptId,
      issueId: issue.issueId,
      issueVersion: 1,
      choiceId: issue.choiceBId,
      subjectId: memberSubject!.id,
      requestState: "COMPLETED",
      requestFingerprint: "d".repeat(64),
      completedAt: new Date(),
    });
    await database.db.insert(votes).values({
      voteAttemptId: attemptId,
      issueId: issue.issueId,
      issueVersion: 1,
      choiceId: issue.choiceBId,
      subjectId: memberSubject!.id,
      integrityState: "ACCEPTED",
      userTier: "MEMBER",
      accountAssurance: "ACCOUNT",
      uniquenessAssurance: "ACCOUNT",
      issueRiskLevel: "LOW",
      eligibilityPolicyVersion: "test-v1",
      integrityPolicyVersion: "test-v1",
      acceptedAt: new Date(),
    });

    const response = await submitComment(
      issue.issueId,
      session.token,
      randomUUID(),
      "직접 투표 우선",
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ comment: { choice: "B" } });
  });

  it("enforces session, vote eligibility, and text policy boundaries", async () => {
    const issue = await createIssue();
    const missingSession = await app.inject({
      method: "POST",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "idempotency-key": randomUUID() },
      payload: { body: "로그인 없음" },
    });
    expect(missingSession.statusCode).toBe(401);

    const noVoteSession = await createSession("comment-no-vote");
    const noVote = await submitComment(
      issue.issueId,
      noVoteSession.token,
      randomUUID(),
      "투표 없음",
    );
    expect(noVote.statusCode).toBe(403);
    expect(noVote.json()).toMatchObject({ code: "VOTE_REQUIRED" });

    const anonymousSubjectId = await createGuestVote(issue.issueId, issue.choiceAId);
    const eligibleSession = await createSession("comment-policy", anonymousSubjectId);
    const policy = await submitComment(
      issue.issueId,
      eligibleSession.token,
      randomUUID(),
      "https://example.com",
    );
    expect(policy.statusCode).toBe(422);
    expect(policy.json()).toMatchObject({ code: "COMMENT_URL_NOT_ALLOWED" });
  });

  it("lets only the author edit and soft-delete a Comment", async () => {
    const issue = await createIssue();
    const authorGuest = await createGuestVote(issue.issueId, issue.choiceAId);
    const author = await createSession(`comment-mutation-author-${issue.issueId}`, authorGuest);
    const published = await submitComment(
      issue.issueId,
      author.token,
      randomUUID(),
      "수정 전 댓글",
    );
    const commentId = published.json<{ comment: { id: string } }>().comment.id;

    const otherGuest = await createGuestVote(issue.issueId, issue.choiceBId);
    const other = await createSession(`comment-mutation-other-${issue.issueId}`, otherGuest);
    const otherList = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(otherList.json()).toMatchObject({
      items: [
        {
          id: commentId,
          permissions: { canEdit: false, canDelete: false },
        },
      ],
    });

    const forbiddenEdit = await updateComment(commentId, other.token, "가로챈 수정");
    const forbiddenDelete = await deleteComment(commentId, other.token);
    expect(forbiddenEdit.statusCode).toBe(403);
    expect(forbiddenEdit.json()).toMatchObject({ code: "COMMENT_AUTHOR_REQUIRED" });
    expect(forbiddenDelete.statusCode).toBe(403);
    expect(forbiddenDelete.json()).toMatchObject({ code: "COMMENT_AUTHOR_REQUIRED" });

    const missingSessionEdit = await app.inject({
      method: "PATCH",
      url: `/v1/comments/${commentId}`,
      payload: { body: "로그인 없는 수정" },
    });
    const missingSessionDelete = await app.inject({
      method: "DELETE",
      url: `/v1/comments/${commentId}`,
    });
    expect(missingSessionEdit.statusCode).toBe(401);
    expect(missingSessionDelete.statusCode).toBe(401);

    const edited = await updateComment(commentId, author.token, "  수정한 댓글  ");
    expect(edited.statusCode).toBe(200);
    const editedBody = edited.json<{
      comment: { id: string; body: string; editedAt: string };
    }>();
    expect(editedBody.comment).toMatchObject({ id: commentId, body: "수정한 댓글" });
    expect(Number.isNaN(Date.parse(editedBody.comment.editedAt))).toBe(false);

    const authorList = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    const authorPage = authorList.json<{
      items: Array<{
        id: string;
        body: string;
        editedAt: string | null;
        permissions: { canEdit: boolean; canDelete: boolean };
      }>;
    }>();
    expect(authorPage).toMatchObject({
      items: [
        {
          id: commentId,
          body: "수정한 댓글",
          permissions: { canEdit: true, canDelete: true },
        },
      ],
    });
    expect(authorPage.items[0]?.editedAt).not.toBeNull();

    const invalidEdit = await updateComment(commentId, author.token, "https://example.com");
    expect(invalidEdit.statusCode).toBe(422);
    expect(invalidEdit.json()).toMatchObject({ code: "COMMENT_URL_NOT_ALLOWED" });

    const deleted = await deleteComment(commentId, author.token);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ comment: { id: commentId, deleted: true } });
    expect((await deleteComment(commentId, author.token)).statusCode).toBe(404);

    const [stored] = await database.db
      .select({
        body: comments.body,
        visibility: comments.visibility,
        deletedAt: comments.deletedAt,
        version: comments.version,
      })
      .from(comments)
      .where(eq(comments.id, commentId));
    expect(stored).toMatchObject({
      body: "[작성자가 삭제한 댓글]",
      visibility: "REMOVED_BY_AUTHOR",
      version: 3,
    });
    expect(stored?.deletedAt).toBeInstanceOf(Date);

    const afterDelete = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments?side=ALL&limit=10`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    expect(afterDelete.json()).toEqual({ items: [], nextCursor: null, totalCount: 0 });

    const events = await database.db
      .select({ type: outboxEvents.eventType })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, commentId));
    expect(events.map((event) => event.type)).toEqual([
      "COMMENT_PUBLISHED",
      "COMMENT_EDITED",
      "COMMENT_REMOVED_BY_AUTHOR",
    ]);
  });
});
