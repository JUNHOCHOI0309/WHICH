import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { CommentService } from "../src/modules/comments/contracts.js";
import type { IssueReadService } from "../src/modules/issues/contracts.js";
import type { MemberIdentityService } from "../src/modules/identity/contracts.js";
import type { GuestVoteService } from "../src/modules/voting/contracts.js";

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const guestVotes: GuestVoteService = {
  createGuestSubject: vi.fn(),
  submitGuestVote: vi.fn(),
};

const issueReader: IssueReadService = {
  getGuestIssue: vi.fn(),
  listGuestIssues: vi.fn(),
};

const commentReader: CommentService = {
  listGuestComments: vi.fn(),
  submitMemberComment: vi.fn(),
  toggleHelpfulReaction: vi.fn(),
  reportComment: vi.fn(),
  listModerationCases: vi.fn(),
  decideModeration: vi.fn(),
};

const memberIdentity: MemberIdentityService = {
  createSession: vi.fn(),
  getSession: vi.fn(),
  revokeSession: vi.fn(),
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("system health", () => {
  it("reports liveness without requiring the database", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "which-api" });
  });

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
});

describe("OpenAPI contract", () => {
  it("publishes the Guest subject and idempotent vote endpoints", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
      issueReader,
      guestVotes,
      commentReader,
      memberIdentity,
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/docs/json" });

    const document = response.json<{ paths: Record<string, unknown> }>();

    expect(response.statusCode).toBe(200);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}", "get"]);
    expect(document.paths).toHaveProperty(["/v1/issues/feed", "get"]);
    expect(document.paths).toHaveProperty(["/v1/guest-subjects", "post"]);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}/votes", "post"]);
    expect(document.paths).toHaveProperty(["/v1/issues/{issueId}/comments", "get"]);
    expect(document.paths).toHaveProperty(["/v1/comments/{commentId}/reactions/helpful", "post"]);
    expect(document.paths).toHaveProperty(["/v1/member-session", "get"]);
    expect(document.paths).toHaveProperty(["/v1/member-session", "delete"]);
  });
});
