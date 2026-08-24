import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headerMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: headerMocks.get }),
}));

import { GET as callback } from "@/app/api/auth/x/callback/route";
import { GET as start } from "@/app/api/auth/x/start/route";
import { AUTH_FLOW_COOKIE, encodeAuthFlow } from "@/lib/server/member-auth";
import { GUEST_SUBJECT_COOKIE } from "@/lib/server/which-api";

const guestSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";

describe("X OAuth routes", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("X_OAUTH_CLIENT_ID", "x-client");
    vi.stubEnv("X_OAUTH_CLIENT_SECRET", "x-secret");
    headerMocks.get.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function flowCookie() {
    return encodeAuthFlow({
      provider: "X",
      state: "x-state",
      codeVerifier: "x-verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
  }

  it("starts at X with a signed HttpOnly flow cookie", async () => {
    const response = await start(
      new Request("http://localhost:3000/api/auth/x/start?returnTo=/issues/issue-1"),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(location.origin + location.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_FLOW_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain("x-secret");
  });

  it("returns to the app when X credentials are unavailable", async () => {
    vi.stubEnv("X_OAUTH_CLIENT_SECRET", "");

    const response = await start(
      new Request("http://localhost:3000/api/auth/x/start?returnTo=/issues/issue-1"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("creates a WHICH session from the authenticated X User ID", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE
        ? { value: flowCookie() }
        : name === GUEST_SUBJECT_COOKIE
          ? { value: guestSubjectId }
          : undefined,
    );
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://api.x.com/2/oauth2/token") {
          return Response.json({ access_token: "ephemeral-access-token" });
        }
        if (url === "https://api.x.com/2/users/me?user.fields=profile_image_url") {
          return Response.json({
            data: {
              id: "x-user-1",
              name: "X 사용자",
              profile_image_url: "https://pbs.twimg.com/profile_images/x-user.jpg",
            },
          });
        }
        if (url === "http://localhost:4000/v1/internal/member-sessions") {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            provider: "X",
            providerSubject: "x-user-1",
            avatarUrl: "https://pbs.twimg.com/profile_images/x-user.jpg",
          });
          return Response.json(
            { token: "which-session", expiresAt: "2026-08-21T00:00:00.000Z" },
            { status: 201 },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/x/callback?code=authorization-code&state=x-state",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=success#member-access",
    );
    expect(response.headers.get("set-cookie")).toContain("which_member_session=which-session");
    expect(response.headers.get("set-cookie")).toContain("which_guest_subject=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(requests).toEqual([
      "https://api.x.com/2/oauth2/token",
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      "http://localhost:4000/v1/internal/member-sessions",
    ]);
  });

  it("rejects a mismatched state before contacting X", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request("http://localhost:3000/api/auth/x/callback?code=code&state=wrong"),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/?auth=error");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns an error without creating a session when token exchange fails", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request("http://localhost:3000/api/auth/x/callback?code=expired&state=x-state"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=error#member-access",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns a cancellation without exchanging a token", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request("http://localhost:3000/api/auth/x/callback?error=access_denied&state=x-state"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=cancelled#member-access",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
