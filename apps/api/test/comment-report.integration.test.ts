import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  commentModerationDecisions,
  commentReports,
  comments,
  issueChoices,
  issues,
  issueVersions,
} from "../src/database/schema/index.js";
import { createCommentService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "comment-report-test-internal-secret";
const MODERATION_SECRET = "comment-report-test-moderation-secret";

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
    question: "Which report policy should apply?",
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
      displayName: "신고 테스트 회원",
      anonymousSubjectId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string }>();
}

async function createPublishedComment(issue: Awaited<ReturnType<typeof createIssue>>) {
  const authorGuest = await createGuestVote(issue.issueId, issue.choiceAId);
  const author = await createSession(`report-author-${issue.issueId}`, authorGuest);
  const response = await app.inject({
    method: "POST",
    url: `/v1/issues/${issue.issueId}/comments`,
    headers: { authorization: `Bearer ${author.token}`, "idempotency-key": randomUUID() },
    payload: { body: "신고 누적 정책을 검증할 댓글" },
  });
  expect(response.statusCode).toBe(201);
  return { id: response.json<{ comment: { id: string } }>().comment.id, author };
}

function reportAsGuest(commentId: string, anonymousSubjectId: string, key = randomUUID()) {
  return app.inject({
    method: "POST",
    url: `/v1/comments/${commentId}/reports`,
    headers: {
      "x-anonymous-subject-id": anonymousSubjectId,
      "idempotency-key": key,
    },
    payload: { reason: "SPAM" },
  });
}

function reportAsMember(commentId: string, token: string, key = randomUUID()) {
  return app.inject({
    method: "POST",
    url: `/v1/comments/${commentId}/reports`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
    payload: { reason: "HARASSMENT" },
  });
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const config = getConfig({
    NODE_ENV: "test",
    INTERNAL_AUTH_SECRET: INTERNAL_SECRET,
    MODERATION_INTERNAL_SECRET: MODERATION_SECRET,
  });
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

describe("Comment report and automatic moderation API", () => {
  it("accepts one eligible Guest report idempotently and rejects unsafe boundaries", async () => {
    const issue = await createIssue();
    const comment = await createPublishedComment(issue);
    const reporter = await createGuestVote(issue.issueId, issue.choiceBId);
    const key = randomUUID();

    const first = await reportAsGuest(comment.id, reporter, key);
    const replay = await reportAsGuest(comment.id, reporter, key);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      report: { accepted: true, viewerReported: true },
      comment: { visibility: "VISIBLE" },
    });
    expect(replay.json()).toEqual(first.json());

    const stored = await database.db
      .select({ weight: commentReports.weight, counted: commentReports.counted })
      .from(commentReports)
      .where(eq(commentReports.commentId, comment.id));
    expect(stored).toEqual([{ weight: 1, counted: true }]);

    const duplicate = await reportAsGuest(comment.id, reporter);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "REPORT_ALREADY_EXISTS" });

    const selfReport = await reportAsMember(comment.id, comment.author.token);
    expect(selfReport.statusCode).toBe(403);
    expect(selfReport.json()).toMatchObject({ code: "REPORT_OWN_COMMENT" });

    const unqualifiedGuest = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
    const noVote = await reportAsGuest(
      comment.id,
      unqualifiedGuest.json<{ anonymousSubjectId: string }>().anonymousSubjectId,
    );
    expect(noVote.statusCode).toBe(403);
    expect(noVote.json()).toMatchObject({ code: "VOTE_REQUIRED" });
  });

  it("collapses at 10 points, hides at 20 points, and restores with a new baseline", async () => {
    const issue = await createIssue();
    const comment = await createPublishedComment(issue);
    const reporters: Array<{ token: string }> = [];

    for (let index = 0; index < 10; index += 1) {
      const guest = await createGuestVote(
        issue.issueId,
        index % 2 === 0 ? issue.choiceAId : issue.choiceBId,
      );
      const reporter = await createSession(`reporter-${issue.issueId}-${index}`, guest);
      reporters.push(reporter);
      const response = await reportAsMember(comment.id, reporter.token);
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        comment: {
          visibility: index >= 9 ? "HIDDEN" : index >= 4 ? "COLLAPSED" : "VISIBLE",
        },
      });

      if (index === 4) {
        const collapsedList = await app.inject({
          method: "GET",
          url: `/v1/issues/${issue.issueId}/comments`,
          headers: { authorization: `Bearer ${reporter.token}` },
        });
        expect(collapsedList.json()).toMatchObject({
          items: [
            {
              id: comment.id,
              visibility: "COLLAPSED",
              reports: { viewerReported: true, canReport: false },
            },
          ],
        });
      }
    }

    const hiddenList = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}/comments`,
      headers: { authorization: `Bearer ${reporters[9]!.token}` },
    });
    expect(hiddenList.json()).toMatchObject({ items: [] });

    const [hidden] = await database.db
      .select({
        publicationState: comments.publicationState,
        visibility: comments.visibility,
        integrityState: comments.integrityState,
      })
      .from(comments)
      .where(eq(comments.id, comment.id));
    expect(hidden).toEqual({
      publicationState: "PENDING_HUMAN_REVIEW",
      visibility: "HIDDEN",
      integrityState: "REVIEW",
    });

    const unauthorizedQueue = await app.inject({
      method: "GET",
      url: "/v1/internal/comment-moderation/cases",
    });
    expect(unauthorizedQueue.statusCode).toBe(401);
    const queue = await app.inject({
      method: "GET",
      url: "/v1/internal/comment-moderation/cases",
      headers: { "x-moderation-auth-secret": MODERATION_SECRET },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      items: [
        {
          commentId: comment.id,
          reportScore: 20,
          reporterCount: 10,
          effectiveReportScore: 20,
          effectiveReporterCount: 10,
        },
      ],
    });

    const restored = await app.inject({
      method: "POST",
      url: `/v1/internal/comments/${comment.id}/moderation-decisions`,
      headers: { "x-moderation-auth-secret": MODERATION_SECRET },
      payload: { action: "RESTORE", reasonCode: "NO_POLICY_VIOLATION" },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      comment: {
        id: comment.id,
        publicationState: "PUBLISHED",
        visibility: "VISIBLE",
        integrityState: "NORMAL",
      },
    });

    const [restoredRow] = await database.db
      .select({
        scoreBaseline: comments.reportScoreBaseline,
        reporterBaseline: comments.reporterCountBaseline,
      })
      .from(comments)
      .where(eq(comments.id, comment.id));
    expect(restoredRow).toEqual({ scoreBaseline: 20, reporterBaseline: 10 });

    const decisions = await database.db
      .select({ action: commentModerationDecisions.action })
      .from(commentModerationDecisions)
      .where(eq(commentModerationDecisions.commentId, comment.id))
      .orderBy(asc(commentModerationDecisions.revision));
    expect(decisions).toEqual([{ action: "COLLAPSE" }, { action: "HIDE" }, { action: "RESTORE" }]);
  });

  it("merges duplicate Guest and Member reports when their identity is linked", async () => {
    const issue = await createIssue();
    const comment = await createPublishedComment(issue);
    const firstGuest = await createGuestVote(issue.issueId, issue.choiceAId);
    const secondGuest = await createGuestVote(issue.issueId, issue.choiceBId);

    expect((await reportAsGuest(comment.id, firstGuest)).statusCode).toBe(201);
    const member = await createSession(`report-link-${issue.issueId}`, secondGuest);
    expect((await reportAsMember(comment.id, member.token)).statusCode).toBe(201);
    await createSession(`report-link-${issue.issueId}`, firstGuest);

    const rows = await database.db
      .select({ counted: commentReports.counted, weight: commentReports.weight })
      .from(commentReports)
      .where(eq(commentReports.commentId, comment.id))
      .orderBy(asc(commentReports.createdAt));
    expect(rows).toEqual([
      { counted: false, weight: 1 },
      { counted: true, weight: 2 },
    ]);
  });
});
