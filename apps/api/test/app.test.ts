import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { CommentService } from "../src/modules/comments/contracts.js";
import type { IssueReadService, IssueWriteService } from "../src/modules/issues/contracts.js";
import type { MemberIdentityService } from "../src/modules/identity/contracts.js";
import type { InterestProfileService } from "../src/modules/interests/contracts.js";
import type { GuestVoteService } from "../src/modules/voting/contracts.js";
import type { MemberPointService } from "../src/modules/points/member-contracts.js";

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const guestVotes: GuestVoteService = {
  createGuestSubject: vi.fn(),
  findGuestVote: vi.fn(),
  submitGuestVote: vi.fn(),
  reconcileIssueVersion: vi.fn(),
};

const getGuestIssue = vi.fn<IssueReadService["getGuestIssue"]>();
const issueReader: IssueReadService = {
  getGuestIssue,
  listGuestIssues: vi.fn(),
  listPublicIssueCatalog: vi.fn(),
};

const createMemberIssue = vi.fn<IssueWriteService["createMemberIssue"]>();
const issueWriter: IssueWriteService = {
  createMemberIssue,
  submitMemberIssue: vi.fn(),
  resubmitMemberIssue: vi.fn(),
  listMemberIssueSubmissions: vi.fn(),
  actOnMemberIssueSubmission: vi.fn(),
};

const commentReader: CommentService = {
  listGuestComments: vi.fn(),
  submitMemberComment: vi.fn(),
  updateMemberComment: vi.fn(),
  deleteMemberComment: vi.fn(),
  toggleCommentReaction: vi.fn(),
  reportComment: vi.fn(),
  listModerationCases: vi.fn(),
  decideModeration: vi.fn(),
};

const getMemberSession = vi.fn<MemberIdentityService["getSession"]>();
const memberIdentity: MemberIdentityService = {
  createSession: vi.fn(),
  createCredentialSession: vi.fn(),
  requestEmailVerification: vi.fn(),
  verifyEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  linkIdentity: vi.fn(),
  getSession: getMemberSession,
  issueMobileAuthExchangeTicket: vi.fn(),
  exchangeMobileAuthTicket: vi.fn(),
  refreshSession: vi.fn(),
  getPrivateProfile: vi.fn(),
  updateProfile: vi.fn(),
  setAvatar: vi.fn(),
  clearAvatar: vi.fn(),
  deleteAccount: vi.fn(),
  getPublicCreatorProfile: vi.fn(),
  findPrivateVote: vi.fn(),
  revokeSession: vi.fn(),
};

const interestProfiles: InterestProfileService = {
  listCards: vi.fn().mockReturnValue([]),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  resetProfile: vi.fn(),
  mergeGuestProfile: vi.fn(),
};

const getMemberPoints = vi.fn<MemberPointService["getMemberPoints"]>();
const memberPoints: MemberPointService = { getMemberPoints };

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("system health", () => {
  it("records safe pool diagnostics for a wrapped connection timeout without changing the error status", async () => {
    const connectionDiagnostics = vi.fn(() => ({
      connectionTimeoutMillis: 10_000,
      maxConnections: 10,
      totalConnections: 10,
      idleConnections: 0,
      waitingRequests: 2,
    }));
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      connectionDiagnostics,
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);
    app.get("/test-connection-timeout", () =>
      Promise.reject(
        new Error("Failed query: private query parameters", {
          cause: new Error("timeout exceeded when trying to connect"),
        }),
      ),
    );
    const response = await app.inject({ method: "GET", url: "/test-connection-timeout" });
    expect(response.statusCode).toBe(500);
    expect(connectionDiagnostics).toHaveBeenCalledOnce();
  });

  it("reports liveness without requiring the database", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      issueWriter,
      guestVotes,
      commentReader,
      memberIdentity,
      interestProfiles,
      memberPoints,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "which-api" });
  }, 15_000);

  it("reports readiness only when the database responds", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", service: "which-api" });
  });

  it("reports the running release identity", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test", RELEASE_ID: "test-release" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/meta" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "which-api", releaseId: "test-release" });
  });
});

describe("safe feature defaults", () => {
  it("keeps political capabilities disabled", () => {
    const config = getConfig({ NODE_ENV: "test" });

    expect(config.featureFlags.politicalVoting).toBe(false);
    expect(config.featureFlags.politicalComments).toBe(false);
  });

  it("rejects the known local internal secret in production", () => {
    expect(() => getConfig({ NODE_ENV: "production" })).toThrow(
      "INTERNAL_AUTH_SECRET must be configured for production.",
    );
  });

  it("requires an identifiable production release", () => {
    expect(() =>
      getConfig({
        NODE_ENV: "production",
        INTERNAL_AUTH_SECRET: "production-internal-secret",
        MODERATION_INTERNAL_SECRET: "production-moderation-secret",
      }),
    ).toThrow("RELEASE_ID must identify the deployed production release.");
  });

  it("uses a container platform port and immutable release identifier", () => {
    const config = getConfig({
      NODE_ENV: "production",
      PORT: "10000",
      RENDER_GIT_COMMIT: "0123456789abcdef",
      INTERNAL_AUTH_SECRET: "production-internal-secret",
      MODERATION_INTERNAL_SECRET: "production-moderation-secret",
    });

    expect(config.server.port).toBe(10000);
    expect(config.releaseId).toBe("0123456789abcdef");
  });

  it("keeps API_PORT as the explicit local override", () => {
    const config = getConfig({ API_PORT: "4000", PORT: "10000" });

    expect(config.server.port).toBe(4000);
  });
});

describe("OpenAPI contract", () => {
  it("publishes the Guest subject and idempotent vote endpoints", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      issueWriter,
      guestVotes,
      commentReader,
      memberIdentity,
      interestProfiles,
      memberPoints,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/docs/json" });

    const document = response.json<{ paths: Record<string, unknown> }>();

    expect(response.statusCode).toBe(200);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}", "get"]);
    expect(document.paths).toHaveProperty(["/v1/issues", "post"]);
    expect(document.paths).toHaveProperty(["/v1/member/issue-submissions", "post"]);
    expect(document.paths).toHaveProperty(["/v1/member/issue-submissions", "get"]);
    expect(document.paths).toHaveProperty(["/v1/member/issue-submissions/{submissionId}", "put"]);
    expect(document.paths).toHaveProperty(["/v1/issues/feed", "get"]);
    expect(document.paths).toHaveProperty(["/v1/issues/catalog", "get"]);
    expect(document.paths).toHaveProperty(["/v1/guest-subjects", "post"]);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}/votes", "post"]);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}/votes", "get"]);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}/comments", "get"]);
    expect(document.paths).toHaveProperty(["/v1/comments/{commentId}/reactions/helpful", "post"]);
    expect(document.paths).toHaveProperty(["/v1/comments/{commentId}/reactions/dislike", "post"]);
    expect(document.paths).toHaveProperty(["/v1/member-session", "get"]);
    expect(document.paths).toHaveProperty(["/v1/member-session", "delete"]);
    expect(document.paths).toHaveProperty(["/v1/me", "get"]);
    expect(document.paths).toHaveProperty(["/v1/me/votes/{issueId}", "get"]);
    expect(document.paths).toHaveProperty(["/v1/me/points", "get"]);
    expect(document.paths).toHaveProperty(["/v1/interests/cards", "get"]);
    expect(document.paths).toHaveProperty(["/v1/interest-profile", "get"]);
    expect(document.paths).toHaveProperty(["/v1/interest-profile", "put"]);
    expect(document.paths).toHaveProperty(["/v1/interest-profile/reset", "post"]);
    expect(document.paths).toHaveProperty(["/v1/interest-profile/merge", "post"]);
  });

  it("keeps the W Point view scoped to the authenticated Member", async () => {
    getMemberSession.mockResolvedValueOnce({
      expiresAt: "2026-08-27T00:00:00.000Z",
      member: {
        id: "591f2e90-996a-50c5-af46-967dd0793000",
        displayName: "Member",
        status: "ACTIVE",
        avatar: { kind: "INITIALS", initials: "M" },
      },
    });
    getMemberPoints.mockResolvedValueOnce({
      account: {
        balance: 20,
        todayEarned: 10,
        lifetimeEarned: 20,
        lifetimeSpent: 0,
        hasPendingRecovery: false,
      },
      badge: {
        policyVersion: "w_badge_v1",
        current: {
          code: "BRONZE",
          label: "브론즈",
          minimumLifetimePoints: 10,
          assetKey: "bronze.webp",
          awardedAt: "2026-08-27T00:00:00.000Z",
        },
        next: {
          code: "SILVER",
          label: "실버",
          minimumLifetimePoints: 1000,
          assetKey: "silver.webp",
        },
        progress: 10 / 990,
      },
      ledger: { items: [], nextCursor: null },
    });
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
      memberPoints,
    });
    openApps.push(app);

    const guest = await app.inject({ method: "GET", url: "/v1/me/points" });
    expect(guest.statusCode).toBe(401);

    const member = await app.inject({
      method: "GET",
      url: "/v1/me/points?limit=5",
      headers: { authorization: "Bearer member-session-token" },
    });
    expect(member.statusCode).toBe(200);
    expect(member.json()).toMatchObject({ account: { balance: 20 } });
    expect(getMemberPoints).toHaveBeenCalledWith("591f2e90-996a-50c5-af46-967dd0793000", {
      limit: 5,
      cursor: undefined,
    });
  });

  it("keeps Member issue creation authenticated and idempotent", async () => {
    const issueId = "876a6750-8efc-4ff1-a923-d4d8959d8f31";
    createMemberIssue.mockResolvedValue({
      created: true,
      issue: {
        id: issueId,
        version: 1,
        question: "퇴근 후 바로 잘까?",
        context: null,
        choices: [
          { code: "A", label: "바로 자기" },
          { code: "B", label: "조금 더 놀기" },
        ],
        interestCardCode: "DAILY_LIFE",
        publishedAt: "2026-08-25T03:00:00.000Z",
      },
    });
    getGuestIssue.mockResolvedValue({
      id: issueId,
      version: 1,
      question: "퇴근 후 바로 잘까?",
      context: null,
      publishedAt: "2026-08-25T03:00:00.000Z",
      categoryCode: "LIFE",
      experienceModeCode: "PLAYFUL_QUICK",
      mediaMode: "TEXT_ONLY",
      choices: [
        {
          id: "9f64f67d-c0e8-4f6a-ab8d-0508926c7e51",
          code: "A",
          label: "바로 자기",
          media: null,
        },
        {
          id: "2375d356-56fb-43ba-a675-d14f3d60ef16",
          code: "B",
          label: "조금 더 놀기",
          media: null,
        },
      ],
      author: null,
      result: { visibility: "PRE_VOTE_HIDDEN", tally: null },
    });
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      issueWriter,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);

    const guest = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: { "idempotency-key": "c41a85f6-a31d-4518-b667-455335d48c39" },
      payload: {
        question: "퇴근 후 바로 잘까",
        choiceA: "바로 자기",
        choiceB: "조금 더 놀기",
        interestCardCode: "DAILY_LIFE",
      },
    });
    expect(guest.statusCode).toBe(401);

    const member = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: {
        authorization: "Bearer member-session-token",
        "idempotency-key": "c41a85f6-a31d-4518-b667-455335d48c39",
      },
      payload: {
        question: "퇴근 후 바로 잘까",
        choiceA: "바로 자기",
        choiceB: "조금 더 놀기",
        interestCardCode: "DAILY_LIFE",
      },
    });
    expect(member.statusCode).toBe(201);
    expect(member.json()).toMatchObject({ created: true, issue: { id: issueId } });
  });
});
