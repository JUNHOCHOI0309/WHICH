import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  guestMemberLinks,
  issueChoices,
  issues,
  issueVersions,
  memberIdentityLinks,
  memberSessions,
  resultSnapshots,
  voteAggregates,
  voteAttempts,
  voteIntegrityDecisions,
  voterSubjects,
  votes,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "member-identity-test-secret";

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
    question: "Member identity test issue",
    contentHash: "b".repeat(64),
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

async function createGuest() {
  const response = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  return response.json<{ anonymousSubjectId: string }>().anonymousSubjectId;
}

async function submitGuestVote(anonymousSubjectId: string, issueId: string, choiceId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/votes`,
    headers: {
      "idempotency-key": randomUUID(),
      "x-anonymous-subject-id": anonymousSubjectId,
    },
    payload: { issueVersion: 1, choiceId },
  });
}

function createMemberSession(input: {
  provider?: "GOOGLE" | "X" | "DEVELOPMENT";
  providerSubject: string;
  anonymousSubjectId?: string;
  email?: string;
}) {
  return app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: input.provider ?? "DEVELOPMENT",
      providerSubject: input.providerSubject,
      displayName: "테스트 회원",
      anonymousSubjectId: input.anonymousSubjectId,
      email: input.email,
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

describe("Member identity and Guest vote linking", () => {
  it("protects the Provider assertion boundary with an internal secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/member-sessions",
      payload: { provider: "DEVELOPMENT", providerSubject: "blocked", displayName: "Blocked" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("persists an X User ID as a distinct Provider identity", async () => {
    const providerSubject = `x-user-${randomUUID()}`;
    const response = await createMemberSession({ provider: "X", providerSubject });

    expect(response.statusCode).toBe(201);
    const memberId = response.json<{ member: { id: string } }>().member.id;
    const links = await database.db
      .select({
        provider: memberIdentityLinks.provider,
        providerSubject: memberIdentityLinks.providerSubject,
      })
      .from(memberIdentityLinks)
      .where(eq(memberIdentityLinks.memberId, memberId));

    expect(links).toEqual([{ provider: "X", providerSubject }]);
  });

  it("maps the same Provider Subject to one Member and stores only a token hash", async () => {
    const first = await createMemberSession({
      providerSubject: "provider-subject-stable",
      email: "first@example.com",
    });
    const second = await createMemberSession({
      providerSubject: "provider-subject-stable",
      email: "changed@example.com",
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstBody = first.json<{ token: string; member: { id: string } }>();
    const secondBody = second.json<{ token: string; member: { id: string } }>();
    expect(secondBody.member.id).toBe(firstBody.member.id);
    expect(secondBody.token).not.toBe(firstBody.token);

    const storedSessions = await database.db
      .select({ tokenHash: memberSessions.tokenHash })
      .from(memberSessions)
      .where(eq(memberSessions.memberId, firstBody.member.id));
    expect(storedSessions).toHaveLength(2);
    expect(storedSessions.every((session) => session.tokenHash.length === 64)).toBe(true);
    expect(storedSessions.some((session) => session.tokenHash === firstBody.token)).toBe(false);

    const read = await app.inject({
      method: "GET",
      url: "/v1/member-session",
      headers: { authorization: `Bearer ${firstBody.token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ member: { id: firstBody.member.id } });

    const revoked = await app.inject({
      method: "DELETE",
      url: "/v1/member-session",
      headers: { authorization: `Bearer ${firstBody.token}` },
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await app.inject({
      method: "GET",
      url: "/v1/member-session",
      headers: { authorization: `Bearer ${firstBody.token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("links a Guest without rewriting its vote or changing the aggregate", async () => {
    const issue = await createIssue();
    const guestId = await createGuest();
    expect((await submitGuestVote(guestId, issue.issueId, issue.choiceAId)).statusCode).toBe(201);

    const response = await createMemberSession({
      providerSubject: `guest-only-${randomUUID()}`,
      anonymousSubjectId: guestId,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      guestLink: { linked: true, invalidatedDuplicateVotes: 0 },
    });

    const [aggregate] = await database.db
      .select()
      .from(voteAggregates)
      .where(eq(voteAggregates.issueId, issue.issueId));
    expect(aggregate).toMatchObject({
      acceptedACount: 1,
      acceptedVoteCount: 1,
      invalidatedVoteCount: 0,
    });

    const [guestSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.anonymousSubjectId, guestId));
    const links = await database.db
      .select()
      .from(guestMemberLinks)
      .where(eq(guestMemberLinks.guestSubjectId, guestSubject!.id));
    expect(links).toHaveLength(1);
  });

  it("keeps the Member vote canonical and corrects a duplicate aggregate exactly once", async () => {
    const issue = await createIssue();
    const guestId = await createGuest();
    expect((await submitGuestVote(guestId, issue.issueId, issue.choiceAId)).statusCode).toBe(201);

    const providerSubject = `duplicate-${randomUUID()}`;
    const initialSession = await createMemberSession({ providerSubject });
    const memberId = initialSession.json<{ member: { id: string } }>().member.id;
    const [memberSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.userId, memberId));
    const attemptId = randomUUID();
    const memberVoteId = randomUUID();
    const now = new Date();
    await database.db.insert(voteAttempts).values({
      id: attemptId,
      idempotencyKey: attemptId,
      issueId: issue.issueId,
      issueVersion: 1,
      choiceId: issue.choiceBId,
      subjectId: memberSubject!.id,
      requestState: "COMPLETED",
      requestFingerprint: "c".repeat(64),
      completedAt: now,
    });
    await database.db.insert(votes).values({
      id: memberVoteId,
      voteAttemptId: attemptId,
      issueId: issue.issueId,
      issueVersion: 1,
      choiceId: issue.choiceBId,
      subjectId: memberSubject!.id,
      integrityState: "ACCEPTED",
      userTier: "MEMBER",
      accountAssurance: "SOCIAL",
      uniquenessAssurance: "ACCOUNT",
      issueRiskLevel: "LOW",
      eligibilityPolicyVersion: "member-low-v1",
      integrityPolicyVersion: "vote-integrity-v1",
      acceptedAt: now,
    });
    await database.db.insert(voteIntegrityDecisions).values({
      voteId: memberVoteId,
      revision: 1,
      toState: "ACCEPTED",
      reasonCode: "ELIGIBLE",
      policyVersion: "vote-integrity-v1",
      actorType: "SYSTEM",
    });
    const [aggregateBefore] = await database.db
      .update(voteAggregates)
      .set({
        resultVersion: sql`${voteAggregates.resultVersion} + 1`,
        voteRequestCount: sql`${voteAggregates.voteRequestCount} + 1`,
        acceptedBCount: sql`${voteAggregates.acceptedBCount} + 1`,
        acceptedVoteCount: sql`${voteAggregates.acceptedVoteCount} + 1`,
        displayedVoteCount: sql`${voteAggregates.displayedVoteCount} + 1`,
      })
      .where(eq(voteAggregates.issueId, issue.issueId))
      .returning();
    await database.db.insert(resultSnapshots).values({
      issueId: issue.issueId,
      issueVersion: 1,
      resultVersion: aggregateBefore!.resultVersion,
      acceptedACount: aggregateBefore!.acceptedACount,
      acceptedBCount: aggregateBefore!.acceptedBCount,
      displayedVoteCount: aggregateBefore!.displayedVoteCount,
      integrityState: aggregateBefore!.integrityState,
    });

    const linked = await createMemberSession({ providerSubject, anonymousSubjectId: guestId });
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({
      guestLink: { linked: true, invalidatedDuplicateVotes: 1 },
    });

    const [aggregate] = await database.db
      .select()
      .from(voteAggregates)
      .where(eq(voteAggregates.issueId, issue.issueId));
    expect(aggregate).toMatchObject({
      acceptedACount: 0,
      acceptedBCount: 1,
      acceptedVoteCount: 1,
      displayedVoteCount: 1,
      invalidatedVoteCount: 1,
      integrityState: "CORRECTED",
    });

    const retry = await createMemberSession({ providerSubject, anonymousSubjectId: guestId });
    expect(retry.json()).toMatchObject({
      guestLink: { linked: false, invalidatedDuplicateVotes: 0 },
    });
    const [aggregateAfterRetry] = await database.db
      .select()
      .from(voteAggregates)
      .where(and(eq(voteAggregates.issueId, issue.issueId), eq(voteAggregates.issueVersion, 1)));
    expect(aggregateAfterRetry).toMatchObject({
      resultVersion: aggregate!.resultVersion,
      invalidatedVoteCount: 1,
    });
  });
});
