import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  commentReactions,
  issueChoices,
  issues,
  issueVersions,
} from "../src/database/schema/index.js";
import { createCommentService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "comment-reaction-test-secret";

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
    question: "Reaction test issue",
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
  const guest = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  const anonymousSubjectId = guest.json<{ anonymousSubjectId: string }>().anonymousSubjectId;
  const vote = await app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/votes`,
    headers: {
      "x-anonymous-subject-id": anonymousSubjectId,
      "idempotency-key": randomUUID(),
    },
    payload: { issueVersion: 1, choiceId },
  });
  expect(vote.statusCode).toBe(201);
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
      displayName: "반응 회원",
      anonymousSubjectId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    token: string;
    guestLink: { migratedReactions: number; mergedDuplicateReactions: number };
  }>();
}

async function createPublishedComment(issue: Awaited<ReturnType<typeof createIssue>>) {
  const authorGuest = await createGuestVote(issue.issueId, issue.choiceAId);
  const author = await createSession(`author-${issue.issueId}`, authorGuest);
  const response = await app.inject({
    method: "POST",
    url: `/v1/issues/${issue.issueId}/comments`,
    headers: { authorization: `Bearer ${author.token}`, "idempotency-key": randomUUID() },
    payload: { body: "공감할 수 있는 댓글" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ comment: { id: string } }>().comment.id;
}

function toggleAsGuest(
  commentId: string,
  anonymousSubjectId: string,
  idempotencyKey = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/v1/comments/${commentId}/reactions/helpful`,
    headers: {
      "x-anonymous-subject-id": anonymousSubjectId,
      "idempotency-key": idempotencyKey,
    },
  });
}

function toggleAsMember(
  commentId: string,
  token: string,
  anonymousSubjectId?: string,
  idempotencyKey = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/v1/comments/${commentId}/reactions/helpful`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(anonymousSubjectId ? { "x-anonymous-subject-id": anonymousSubjectId } : {}),
      "idempotency-key": idempotencyKey,
    },
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

describe("Comment HELPFUL reaction API", () => {
  it("lets an eligible Guest toggle and idempotently replay a reaction", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const guest = await createGuestVote(issue.issueId, issue.choiceBId);
    const idempotencyKey = randomUUID();

    const activated = await toggleAsGuest(commentId, guest, idempotencyKey);
    const replay = await toggleAsGuest(commentId, guest, idempotencyKey);
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toEqual({
      reaction: { code: "HELPFUL", active: true, helpfulCount: 1 },
    });
    expect(replay.json()).toEqual(activated.json());

    const commentsResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { "x-anonymous-subject-id": guest },
    });
    expect(commentsResponse.json()).toMatchObject({
      items: [
        {
          id: commentId,
          reactions: { helpfulCount: 1, viewerReacted: true },
        },
      ],
    });

    const deactivated = await toggleAsGuest(commentId, guest);
    expect(deactivated.json()).toEqual({
      reaction: { code: "HELPFUL", active: false, helpfulCount: 0 },
    });
  });

  it("requires a same-Issue accepted Vote", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const guest = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
    const anonymousSubjectId = guest.json<{ anonymousSubjectId: string }>().anonymousSubjectId;

    const response = await toggleAsGuest(commentId, anonymousSubjectId);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "VOTE_REQUIRED" });
  });

  it("accepts the current unlinked Guest Vote for a signed-in Member", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const currentGuest = await createGuestVote(issue.issueId, issue.choiceBId);
    const member = await createSession(`unlinked-reaction-member-${issue.issueId}`);

    const response = await toggleAsMember(commentId, member.token, currentGuest);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reaction: { code: "HELPFUL", active: true, helpfulCount: 1 },
    });
  });

  it("does not borrow a Guest Vote linked to a different Member", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const linkedGuest = await createGuestVote(issue.issueId, issue.choiceBId);
    await createSession(`guest-owner-${issue.issueId}`, linkedGuest);
    const otherMember = await createSession(`other-reaction-member-${issue.issueId}`);

    const response = await toggleAsMember(commentId, otherMember.token, linkedGuest);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "VOTE_REQUIRED" });
  });

  it("lets an author react to their own Comment", async () => {
    const issue = await createIssue();
    const authorGuest = await createGuestVote(issue.issueId, issue.choiceAId);
    const author = await createSession(`self-reaction-author-${issue.issueId}`, authorGuest);
    const comment = await app.inject({
      method: "POST",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": randomUUID() },
      payload: { body: "본인 공감이 허용되는 댓글" },
    });
    const commentId = comment.json<{ comment: { id: string } }>().comment.id;

    const response = await toggleAsMember(commentId, author.token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reaction: { code: "HELPFUL", active: true, helpfulCount: 1 },
    });
  });

  it("migrates a Guest reaction on login and toggles it off as the Member", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const guest = await createGuestVote(issue.issueId, issue.choiceBId);
    expect((await toggleAsGuest(commentId, guest)).statusCode).toBe(200);

    const member = await createSession(`migrated-reaction-member-${issue.issueId}`, guest);
    expect(member.guestLink).toMatchObject({
      migratedReactions: 1,
      mergedDuplicateReactions: 0,
    });

    const response = await toggleAsMember(commentId, member.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reaction: { code: "HELPFUL", active: false, helpfulCount: 0 },
    });
  });

  it("collapses duplicate Guest and Member reactions when identity is linked", async () => {
    const issue = await createIssue();
    const commentId = await createPublishedComment(issue);
    const firstGuest = await createGuestVote(issue.issueId, issue.choiceAId);
    const secondGuest = await createGuestVote(issue.issueId, issue.choiceBId);

    expect((await toggleAsGuest(commentId, firstGuest)).statusCode).toBe(200);
    const member = await createSession(`reaction-member-${issue.issueId}`, secondGuest);
    expect((await toggleAsMember(commentId, member.token)).statusCode).toBe(200);

    const linked = await createSession(`reaction-member-${issue.issueId}`, firstGuest);
    expect(linked.guestLink).toMatchObject({
      migratedReactions: 0,
      mergedDuplicateReactions: 1,
    });

    const activeRows = await database.db
      .select({ id: commentReactions.id })
      .from(commentReactions)
      .where(and(eq(commentReactions.commentId, commentId), eq(commentReactions.active, true)));
    const mergedRows = await database.db
      .select({ mergedInto: commentReactions.mergedIntoReactionId })
      .from(commentReactions)
      .where(and(eq(commentReactions.commentId, commentId), eq(commentReactions.active, false)));
    expect(activeRows).toHaveLength(1);
    expect(mergedRows).toEqual([{ mergedInto: activeRows[0]!.id }]);
  });
});
