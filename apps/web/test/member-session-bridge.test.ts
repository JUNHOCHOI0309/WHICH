import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOAuthMemberSession,
  createProviderMemberSession,
  memberIdForLinkIntent,
} from "@/lib/server/member-session-bridge";

const guestSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";

describe("Provider member session bridge", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("retries without Guest linking when the Guest Subject belongs to another Member", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return Response.json(
          { code: "GUEST_ALREADY_LINKED", message: "Guest already linked." },
          { status: 409 },
        );
      }
      return Response.json(
        { token: "which-session", expiresAt: "2026-08-23T00:00:00.000Z" },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);

    await expect(
      createProviderMemberSession({
        provider: "NAVER",
        providerSubject: "naver-subject",
        displayName: "네이버 회원",
        anonymousSubjectId: guestSubjectId,
      }),
    ).resolves.toEqual({
      token: "which-session",
      expiresAt: "2026-08-23T00:00:00.000Z",
    });
    expect(requestBodies).toEqual([
      {
        provider: "NAVER",
        providerSubject: "naver-subject",
        displayName: "네이버 회원",
        anonymousSubjectId: guestSubjectId,
      },
      {
        provider: "NAVER",
        providerSubject: "naver-subject",
        displayName: "네이버 회원",
      },
    ]);
  });

  it("does not hide unrelated session conflicts", async () => {
    const request = vi.fn(async () =>
      Response.json({ code: "OTHER_CONFLICT", message: "Conflict." }, { status: 409 }),
    );
    vi.stubGlobal("fetch", request);

    await expect(
      createProviderMemberSession({
        provider: "GOOGLE",
        providerSubject: "google-subject",
        displayName: "Google 회원",
        anonymousSubjectId: guestSubjectId,
      }),
    ).rejects.toThrow("WHICH Member session creation failed.");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resolves the canonical Member only for an authenticated link intent", async () => {
    const memberId = "591f2e90-996a-50c5-af46-967dd0793000";
    const request = vi.fn(async () => Response.json({ member: { id: memberId } }, { status: 200 }));
    vi.stubGlobal("fetch", request);

    await expect(
      memberIdForLinkIntent(new URL("https://whichone.site/me?intent=link"), "session-token"),
    ).resolves.toBe(memberId);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/member-session"),
      expect.objectContaining({
        headers: {
          accept: "application/json",
          authorization: "Bearer session-token",
        },
      }),
    );
  });

  it("requires an active Member session before starting account linking", async () => {
    await expect(
      memberIdForLinkIntent(new URL("https://whichone.site/me?intent=link")),
    ).rejects.toThrow("A Member session is required");
  });

  it("links a Provider identity to the canonical Member from the signed OAuth flow", async () => {
    const memberId = "591f2e90-996a-50c5-af46-967dd0793000";
    const requestBodies: Record<string, unknown>[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(
        { token: "linked-session", expiresAt: "2026-08-23T00:00:00.000Z" },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);

    await expect(
      createOAuthMemberSession(
        {
          provider: "NAVER",
          state: "state",
          codeVerifier: "verifier",
          returnTo: "/me#connected-accounts",
          intent: "LINK",
          linkMemberId: memberId,
          createdAt: Date.now(),
        },
        {
          provider: "NAVER",
          providerSubject: "naver-subject",
          displayName: "네이버 회원",
          anonymousSubjectId: guestSubjectId,
        },
      ),
    ).resolves.toEqual({
      token: "linked-session",
      expiresAt: "2026-08-23T00:00:00.000Z",
    });
    expect(requestBodies).toEqual([
      {
        memberId,
        provider: "NAVER",
        providerSubject: "naver-subject",
        displayName: "네이버 회원",
      },
    ]);
  });
});
