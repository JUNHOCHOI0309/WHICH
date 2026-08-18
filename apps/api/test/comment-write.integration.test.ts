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

function submitComment(issueId: string, token: string, idempotencyKey: string, body: string) {
  return app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/comments`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    payload: { body },
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

    const duplicate = await submitComment(
      issue.issueId,
      session.token,
      randomUUID(),
      "두 번째 댓글",
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "COMMENT_ALREADY_EXISTS" });
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
});
