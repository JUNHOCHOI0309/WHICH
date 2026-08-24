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
  memberCredentials,
  memberAuthTokens,
  memberIdentityLinks,
  memberProfiles,
  memberSessions,
  members,
  recommendationRequests,
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
  provider?: "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";
  providerSubject: string;
  anonymousSubjectId?: string;
  createIfMissing?: boolean;
  credential?: { email: string; password: string };
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
      createIfMissing: input.createIfMissing,
      credential: input.credential,
    },
  });
}

function linkMemberIdentity(input: {
  memberId: string;
  provider: "GOOGLE" | "X" | "NAVER" | "KAKAO";
  providerSubject: string;
}) {
  return app.inject({
    method: "POST",
    url: "/v1/internal/member-identity-links",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      memberId: input.memberId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      displayName: "연결 테스트 회원",
    },
  });
}

async function verifyCredentialEmail(email: string) {
  const requested = await app.inject({
    method: "POST",
    url: "/v1/internal/member-email-verification-requests",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: { email, authRequestKey: randomUUID() },
  });
  expect(requested.statusCode).toBe(200);
  const token = requested.json<{ token: string }>().token;
  const confirmed = await app.inject({
    method: "POST",
    url: "/v1/internal/member-email-verifications",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: { token, authRequestKey: randomUUID() },
  });
  expect(confirmed.statusCode).toBe(200);
  return token;
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

  it("requires registration instead of auto-creating an unlinked OAuth Member", async () => {
    const before = await database.db.select({ id: members.id }).from(members);
    const response = await createMemberSession({
      provider: "GOOGLE",
      providerSubject: `unlinked-${randomUUID()}`,
      createIfMissing: false,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "IDENTITY_SIGNUP_REQUIRED" });
    const after = await database.db.select({ id: members.id }).from(members);
    expect(after).toHaveLength(before.length);
  });

  it("creates one Member with credential and social identities, then signs in by email", async () => {
    const email = `Member-${randomUUID()}@Example.com`;
    const password = "correct horse battery staple";
    const signup = await createMemberSession({
      provider: "KAKAO",
      providerSubject: `kakao-signup-${randomUUID()}`,
      credential: { email, password },
    });

    expect(signup.statusCode).toBe(201);
    const memberId = signup.json<{ member: { id: string } }>().member.id;
    const credentials = await database.db
      .select({
        email: memberCredentials.emailNormalized,
        passwordHash: memberCredentials.passwordHash,
      })
      .from(memberCredentials)
      .where(eq(memberCredentials.memberId, memberId));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.email).toBe(email.toLowerCase());
    expect(credentials[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credentials[0]?.passwordHash).not.toContain(password);

    const links = await database.db
      .select({ provider: memberIdentityLinks.provider })
      .from(memberIdentityLinks)
      .where(eq(memberIdentityLinks.memberId, memberId));
    expect(links).toEqual(expect.arrayContaining([{ provider: "EMAIL" }, { provider: "KAKAO" }]));

    const unverified = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credential-sessions",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email: email.toUpperCase(), password },
    });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json()).toMatchObject({ code: "EMAIL_UNVERIFIED" });

    await verifyCredentialEmail(email);
    const login = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credential-sessions",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email: email.toUpperCase(), password },
    });
    expect(login.statusCode).toBe(201);
    expect(login.json()).toMatchObject({ member: { id: memberId } });

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credential-sessions",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email, password: "this password is definitely wrong" },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({ code: "CREDENTIAL_INVALID" });
  });

  it("lets an existing social-only Member complete email and password login", async () => {
    const social = await createMemberSession({
      provider: "NAVER",
      providerSubject: `naver-complete-${randomUUID()}`,
    });
    const memberId = social.json<{ member: { id: string } }>().member.id;
    const email = `complete-${randomUUID()}@example.com`;
    const password = "a long existing member passphrase";

    const completed = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credentials",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { memberId, email, password },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json()).toMatchObject({ member: { id: memberId }, email });

    await verifyCredentialEmail(email);

    const login = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credential-sessions",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email, password },
    });
    expect(login.statusCode).toBe(201);
    expect(login.json()).toMatchObject({ member: { id: memberId } });
  });

  it("uses one-time hashed password reset tokens and revokes existing sessions", async () => {
    const email = `reset-${randomUUID()}@example.com`;
    const password = "initial correct horse battery";
    const signup = await createMemberSession({
      provider: "EMAIL",
      providerSubject: email,
      credential: { email, password },
    });
    const existingToken = signup.json<{ token: string }>().token;
    await verifyCredentialEmail(email);

    const requested = await app.inject({
      method: "POST",
      url: "/v1/internal/member-password-reset-requests",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email, authRequestKey: randomUUID() },
    });
    expect(requested.statusCode).toBe(200);
    const resetToken = requested.json<{ token: string }>().token;
    const [stored] = await database.db
      .select({ tokenHash: memberAuthTokens.tokenHash })
      .from(memberAuthTokens)
      .where(eq(memberAuthTokens.purpose, "PASSWORD_RESET"));
    expect(stored?.tokenHash).toHaveLength(64);
    expect(stored?.tokenHash).not.toBe(resetToken);

    const newPassword = "new secure passphrase for which";
    const reset = await app.inject({
      method: "POST",
      url: "/v1/internal/member-password-resets",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { token: resetToken, password: newPassword, authRequestKey: randomUUID() },
    });
    expect(reset.statusCode).toBe(200);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/internal/member-password-resets",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { token: resetToken, password: newPassword, authRequestKey: randomUUID() },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ code: "AUTH_TOKEN_INVALID" });

    const oldSession = await app.inject({
      method: "GET",
      url: "/v1/member-session",
      headers: { authorization: `Bearer ${existingToken}` },
    });
    expect(oldSession.statusCode).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/v1/internal/member-credential-sessions",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email, password: newPassword },
    });
    expect(login.statusCode).toBe(201);
  });

  it("does not reveal whether a password reset email is registered and rate limits shared keys", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/v1/internal/member-password-reset-requests",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email: `missing-${randomUUID()}@example.com`, authRequestKey: randomUUID() },
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.body).toBe("null");

    const rateKey = randomUUID();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await app.inject({
        method: "POST",
        url: "/v1/internal/member-password-reset-requests",
        headers: { "x-internal-auth-secret": INTERNAL_SECRET },
        payload: { email: `absent-${randomUUID()}@example.com`, authRequestKey: rateKey },
      });
      expect(allowed.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/internal/member-password-reset-requests",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload: { email: `absent-${randomUUID()}@example.com`, authRequestKey: rateKey },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "AUTH_RATE_LIMITED" });
  });

  it("keeps the private Member profile behind the session token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects an invalid private vote history cursor", async () => {
    const session = await createMemberSession({ providerSubject: `cursor-${randomUUID()}` });
    const token = session.json<{ token: string }>().token;
    const response = await app.inject({
      method: "GET",
      url: "/v1/me?cursor=not-a-cursor",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CURSOR" });
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

  it("persists a Naver pairwise Subject as a distinct Provider identity", async () => {
    const providerSubject = `naver-subject-${randomUUID()}`;
    const response = await createMemberSession({ provider: "NAVER", providerSubject });

    expect(response.statusCode).toBe(201);
    const memberId = response.json<{ member: { id: string } }>().member.id;
    const links = await database.db
      .select({
        provider: memberIdentityLinks.provider,
        providerSubject: memberIdentityLinks.providerSubject,
      })
      .from(memberIdentityLinks)
      .where(eq(memberIdentityLinks.memberId, memberId));

    expect(links).toEqual([{ provider: "NAVER", providerSubject }]);
  });

  it("persists a Kakao Subject as a distinct Provider identity", async () => {
    const providerSubject = `kakao-subject-${randomUUID()}`;
    const response = await createMemberSession({ provider: "KAKAO", providerSubject });

    expect(response.statusCode).toBe(201);
    const memberId = response.json<{ member: { id: string } }>().member.id;
    const links = await database.db
      .select({
        provider: memberIdentityLinks.provider,
        providerSubject: memberIdentityLinks.providerSubject,
      })
      .from(memberIdentityLinks)
      .where(eq(memberIdentityLinks.memberId, memberId));

    expect(links).toEqual([{ provider: "KAKAO", providerSubject }]);
  });

  it("links multiple Provider identities to one canonical Member", async () => {
    const googleSubject = `google-link-${randomUUID()}`;
    const naverSubject = `naver-link-${randomUUID()}`;
    const google = await createMemberSession({
      provider: "GOOGLE",
      providerSubject: googleSubject,
    });
    const memberId = google.json<{ member: { id: string } }>().member.id;

    const linked = await linkMemberIdentity({
      memberId,
      provider: "NAVER",
      providerSubject: naverSubject,
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({
      member: { id: memberId },
      identity: { provider: "NAVER", linked: true },
    });

    const naverLogin = await createMemberSession({
      provider: "NAVER",
      providerSubject: naverSubject,
    });
    expect(naverLogin.statusCode).toBe(201);
    expect(naverLogin.json()).toMatchObject({ member: { id: memberId } });

    const token = linked.json<{ token: string }>().token;
    const profile = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ identities: Array<{ provider: string }> }>().identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "GOOGLE" }),
        expect.objectContaining({ provider: "NAVER" }),
      ]),
    );
  });

  it("merges an existing Provider Member with recommendation history and preserves Guest votes", async () => {
    const issue = await createIssue();
    const guestId = await createGuest();
    await submitGuestVote(guestId, issue.issueId, issue.choiceAId);

    const googleSubject = `google-duplicate-${randomUUID()}`;
    const google = await createMemberSession({
      provider: "GOOGLE",
      providerSubject: googleSubject,
      anonymousSubjectId: guestId,
    });
    const googleBody = google.json<{ token: string; member: { id: string } }>();
    const [googleMemberSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.userId, googleBody.member.id));
    const recommendationRequestId = randomUUID();
    await database.db.insert(recommendationRequests).values({
      id: recommendationRequestId,
      subjectId: googleMemberSubject!.id,
      rankingVersion: "identity-test-v1",
      rankingMode: "RECENCY",
      reasonCode: "RECENCY",
    });
    const naver = await createMemberSession({
      provider: "NAVER",
      providerSubject: `naver-canonical-${randomUUID()}`,
    });
    const naverMemberId = naver.json<{ member: { id: string } }>().member.id;

    const response = await linkMemberIdentity({
      memberId: naverMemberId,
      provider: "GOOGLE",
      providerSubject: googleSubject,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      member: { id: naverMemberId },
      identity: { provider: "GOOGLE", linked: true, memberMerged: true },
    });

    const googleLogin = await createMemberSession({
      provider: "GOOGLE",
      providerSubject: googleSubject,
    });
    expect(googleLogin.json()).toMatchObject({ member: { id: naverMemberId } });

    const oldGoogleSession = await app.inject({
      method: "GET",
      url: "/v1/member-session",
      headers: { authorization: `Bearer ${googleBody.token}` },
    });
    expect(oldGoogleSession.statusCode).toBe(401);

    const mergedToken = response.json<{ token: string }>().token;
    const profile = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${mergedToken}` },
    });
    expect(profile.json()).toMatchObject({
      member: { id: naverMemberId, participationCount: 1 },
      votes: { items: [expect.objectContaining({ issueId: issue.issueId, choice: "A" })] },
    });

    const [sourceMember] = await database.db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, googleBody.member.id));
    expect(sourceMember?.status).toBe("DELETED");
    const [guestSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.anonymousSubjectId, guestId));
    const [guestLink] = await database.db
      .select({ memberId: guestMemberLinks.memberId })
      .from(guestMemberLinks)
      .where(eq(guestMemberLinks.guestSubjectId, guestSubject!.id));
    expect(guestLink?.memberId).toBe(naverMemberId);
    const [recommendationHistory] = await database.db
      .select({ subjectId: recommendationRequests.subjectId })
      .from(recommendationRequests)
      .where(eq(recommendationRequests.id, recommendationRequestId));
    expect(recommendationHistory?.subjectId).toBe(googleMemberSubject!.id);
  });

  it("requires reviewed merging when the existing Provider Member owns a profile", async () => {
    const target = await createMemberSession({
      provider: "GOOGLE",
      providerSubject: `google-owner-${randomUUID()}`,
    });
    const sourceSubject = `naver-owner-${randomUUID()}`;
    const source = await createMemberSession({ provider: "NAVER", providerSubject: sourceSubject });
    await database.db.insert(memberProfiles).values({
      memberId: source.json<{ member: { id: string } }>().member.id,
      handle: `review_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    });

    const response = await linkMemberIdentity({
      memberId: target.json<{ member: { id: string } }>().member.id,
      provider: "NAVER",
      providerSubject: sourceSubject,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "MEMBER_MERGE_REQUIRES_REVIEW" });

    const sourceMemberId = source.json<{ member: { id: string } }>().member.id;
    const [sourceAfter] = await database.db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, sourceMemberId));
    const [sourceIdentity] = await database.db
      .select({ memberId: memberIdentityLinks.memberId })
      .from(memberIdentityLinks)
      .where(eq(memberIdentityLinks.providerSubject, sourceSubject));
    expect(sourceAfter?.status).toBe("ACTIVE");
    expect(sourceIdentity?.memberId).toBe(sourceMemberId);
  });

  it("maps the same Provider Subject to one Member and stores only a token hash", async () => {
    const first = await createMemberSession({
      providerSubject: "provider-subject-stable",
    });
    const second = await createMemberSession({
      providerSubject: "provider-subject-stable",
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
    const token = response.json<{ token: string }>().token;

    const profile = await app.inject({
      method: "GET",
      url: "/v1/me?limit=1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      member: { displayName: "테스트 회원", participationCount: 1 },
      votes: {
        items: [
          {
            issueId: issue.issueId,
            question: "Member identity test issue",
            categoryCode: "TEST",
            choice: "A",
            choiceLabel: "A",
          },
        ],
        nextCursor: null,
      },
    });

    const restored = await app.inject({
      method: "GET",
      url: `/v1/me/votes/${issue.issueId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ issueId: issue.issueId, choice: "A" });

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
    const linkedToken = linked.json<{ token: string }>().token;

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

    const profile = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${linkedToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      member: { id: memberId, participationCount: 1 },
      votes: {
        items: [{ voteId: memberVoteId, issueId: issue.issueId, choice: "B" }],
      },
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
