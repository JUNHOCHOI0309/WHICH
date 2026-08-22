import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderMemberSession } from "@/lib/server/member-session-bridge";

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
});
