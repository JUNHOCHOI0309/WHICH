import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headerMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: headerMocks.get }) }));
vi.mock("@/lib/server/member-avatar-bridge", () => ({ cacheSocialAvatar: vi.fn() }));

import { GET as start } from "@/app/api/auth/tiktok/start/route";
import { GET as callback } from "@/app/api/auth/tiktok/callback/route";
import { POST as signup } from "@/app/api/auth/signup/social/route";
import {
  AUTH_FLOW_COOKIE,
  SOCIAL_SIGNUP_COOKIE,
  decodeAuthFlow,
  decodeSocialSignupTicket,
  encodeAuthFlow,
  encodeSocialSignupTicket,
  type AuthFlow,
} from "@/lib/server/member-auth";
import { tiktokLoginAvailable } from "@/lib/server/tiktok-oauth";
import { GUEST_SUBJECT_COOKIE, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

const origin = "https://sandbox.which.example";
const guestId = "591f2e90-996a-50c5-af46-967dd0793000";
const memberId = "591f2e90-996a-50c5-af46-967dd0793001";
const tokenResponse = {
  access_token: "ephemeral-token",
  refresh_token: "unused-refresh",
  open_id: "app-scoped-id",
  token_type: "Bearer",
  scope: "user.info.basic",
};
const profileResponse = {
  data: {
    user: {
      open_id: "app-scoped-id",
      display_name: "틱톡 회원",
      avatar_url: "https://p19-sign.tiktokcdn-us.com/avatar.png",
    },
  },
  error: { code: "ok" },
};

describe("TikTok Web Login Kit", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", origin);
    vi.stubEnv("AUTH_FLOW_SECRET", "test-flow-secret-not-a-real-secret");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "internal-test-only");
    vi.stubEnv("API_BASE_URL", "http://localhost:4000");
    vi.stubEnv("TIKTOK_OAUTH_CLIENT_KEY", "sandbox-key");
    vi.stubEnv("TIKTOK_OAUTH_CLIENT_SECRET", "sandbox-secret");
    vi.stubEnv("FEATURE_TIKTOK_LOGIN_ENABLED", "true");
    headerMocks.get.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function flowCookie(overrides: Partial<AuthFlow> = {}) {
    return encodeAuthFlow({
      provider: "TIKTOK",
      state: "tiktok-state",
      returnTo: "/me#profile",
      anonymousSubjectId: guestId,
      createdAt: Date.now(),
      ...overrides,
    } as AuthFlow);
  }
  function setFlow(overrides: Partial<AuthFlow> = {}) {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie(overrides) } : undefined,
    );
  }
  function request(query = "state=tiktok-state&code=authorization-code") {
    return new Request(`${origin}/api/auth/tiktok/callback?${query}`);
  }
  function mockProvider(
    token: unknown = tokenResponse,
    profile: unknown = profileResponse,
    session: unknown = { token: "which-session", expiresAt: "2099-01-01T00:00:00Z" },
    status = 201,
  ) {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("client_key")).toBe("sandbox-key");
        expect(form.get("client_secret")).toBe("sandbox-secret");
        expect(form.get("redirect_uri")).toBe(`${origin}/api/auth/tiktok/callback`);
        expect(form.has("code_verifier")).toBe(false);
        return Response.json(token);
      }
      if (url.startsWith("https://open.tiktokapis.com/v2/user/info/")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ephemeral-token");
        expect(new URL(url).searchParams.get("fields")).toBe("open_id,display_name,avatar_url");
        return Response.json(profile);
      }
      if (url.endsWith("/v1/internal/member-sessions")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          provider: "TIKTOK",
          providerSubject: "app-scoped-id",
          createIfMissing: false,
          anonymousSubjectId: guestId,
        });
        expect(String(init?.body)).not.toMatch(/ephemeral-token|unused-refresh|sandbox-secret/);
        return Response.json(session, { status });
      }
      throw new Error("Unexpected endpoint in test");
    });
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("uses Web OAuth and a fixed HTTPS callback with a Secure state cookie", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === GUEST_SUBJECT_COOKIE ? { value: guestId } : undefined,
    );
    const response = await start(new Request(`${origin}/api/auth/tiktok/start?returnTo=/me`));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(location.searchParams.get("scope")).toBe("user.info.basic");
    expect(location.searchParams.get("disable_auto_auth")).toBe("1");
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/tiktok/callback`);
    for (const key of ["client_secret", "nonce", "code_challenge"])
      expect(location.searchParams.has(key)).toBe(false);
    const cookie = response.cookies.get(AUTH_FLOW_COOKIE)!;
    expect(decodeAuthFlow(cookie.value)).toMatchObject({
      provider: "TIKTOK",
      state: location.searchParams.get("state"),
      anonymousSubjectId: guestId,
    });
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/api/auth",
    });
    expect(response.headers.get("set-cookie")).not.toContain("sandbox-secret");
  });

  it.each([
    ["FEATURE_TIKTOK_LOGIN_ENABLED", "false"],
    ["TIKTOK_OAUTH_CLIENT_KEY", ""],
    ["TIKTOK_OAUTH_CLIENT_SECRET", ""],
    ["AUTH_BASE_URL", "http://localhost:3000"],
  ])("fails closed when %s is unavailable", async (key, value) => {
    vi.stubEnv(key, value);
    expect(tiktokLoginAvailable()).toBe(false);
    expect(
      (await start(new Request(`${origin}/api/auth/tiktok/start`))).headers.get("location"),
    ).toContain("auth=unavailable");
    setFlow();
    expect((await callback(request())).headers.get("location")).toContain("auth=unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/mobile-auth/complete?state=123",
    "/api/mobile/auth/complete",
    "/%6dobile-auth/complete",
  ])("blocks native handoff %s", async (returnTo) => {
    expect(tiktokLoginAvailable(returnTo)).toBe(false);
    expect(
      (
        await start(
          new Request(`${origin}/api/auth/tiktok/start?${new URLSearchParams({ returnTo })}`),
        )
      ).headers.get("location"),
    ).toContain("auth=unavailable");
    setFlow({ returnTo });
    expect((await callback(request())).headers.get("location")).toContain("auth=unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a WHICH session without leaking provider tokens", async () => {
    setFlow();
    mockProvider();
    const response = await callback(request());
    expect(response.headers.get("location")).toBe(`${origin}/me?auth=success#profile`);
    expect(response.cookies.get(MEMBER_SESSION_COOKIE)).toMatchObject({
      value: "which-session",
      secure: true,
      httpOnly: true,
    });
    expect(response.cookies.get("which_recent_login_provider")).toMatchObject({
      value: "tiktok",
      secure: true,
      httpOnly: true,
    });
    expect(response.cookies.get(AUTH_FLOW_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(GUEST_SUBJECT_COOKIE)?.maxAge).toBe(0);
    expect(response.headers.get("set-cookie")).not.toMatch(
      /ephemeral-token|unused-refresh|sandbox-secret/,
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("requires explicit signup or linking with no invented email", async () => {
    setFlow();
    mockProvider(tokenResponse, profileResponse, { code: "IDENTITY_SIGNUP_REQUIRED" }, 409);
    const response = await callback(request());
    expect(response.headers.get("location")).toBe(`${origin}/signup/social`);
    expect(response.cookies.get(MEMBER_SESSION_COOKIE)).toBeUndefined();
    const cookie = response.cookies.get(SOCIAL_SIGNUP_COOKIE)!;
    expect(cookie.secure).toBe(true);
    expect(decodeSocialSignupTicket(cookie.value)).toMatchObject({
      provider: "TIKTOK",
      providerSubject: "app-scoped-id",
      anonymousSubjectId: guestId,
    });
    expect(decodeSocialSignupTicket(cookie.value)).not.toHaveProperty("suggestedEmail");
    expect(cookie.value).not.toContain("app-scoped-id");
  });

  it.each([
    "state=wrong&code=code",
    "state=tiktok-state&state=duplicate&code=code",
    "state=tiktok-state",
    "state=tiktok-state&code=a&code=b",
  ])("rejects invalid callback %s before token exchange", async (query) => {
    setFlow();
    expect((await callback(request(query))).headers.get("location")).toContain("auth=error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects missing, tampered, expired, future, and cross-provider flows", async () => {
    for (const cookie of [
      undefined,
      `${flowCookie()}tamper`,
      flowCookie({ createdAt: Date.now() - 601_000 }),
      flowCookie({ provider: "X", codeVerifier: "verifier" }),
      flowCookie({ createdAt: Date.now() + 60_000 }),
    ]) {
      headerMocks.get.mockReturnValue(cookie ? { value: cookie } : undefined);
      expect((await callback(request())).headers.get("location")).toContain("auth=error");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles cancellation without calling TikTok", async () => {
    setFlow();
    const response = await callback(request("state=tiktok-state&error=access_denied"));
    expect(response.headers.get("location")).toBe(`${origin}/me?auth=cancelled#profile`);
    expect(response.cookies.get(AUTH_FLOW_COOKIE)?.maxAge).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...tokenResponse, scope: "video.list" },
    { ...tokenResponse, access_token: undefined },
    { ...tokenResponse, error: "invalid_grant" },
    { ...tokenResponse, open_id: "" },
  ])("rejects invalid token responses", async (token) => {
    setFlow();
    const upstream = mockProvider(token);
    expect((await callback(request())).headers.get("location")).toContain("auth=error");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched identity and profile API errors", async () => {
    setFlow();
    for (const profile of [
      { data: { user: { open_id: "other-user" } }, error: { code: "ok" } },
      { error: { code: "scope_not_authorized" } },
    ]) {
      const upstream = mockProvider(tokenResponse, profile);
      expect((await callback(request())).headers.get("location")).toContain("auth=error");
      expect(upstream).toHaveBeenCalledTimes(2);
    }
  });

  it("does not forward an unsafe avatar URL", async () => {
    setFlow();
    const upstream = mockProvider(tokenResponse, {
      data: {
        user: {
          ...profileResponse.data.user,
          avatar_url: "https://tiktokcdn.com.evil.example/avatar",
        },
      },
      error: { code: "ok" },
    });
    expect((await callback(request())).headers.get("location")).toContain("auth=success");
    expect(JSON.parse(String(upstream.mock.calls[2]?.[1]?.body))).not.toHaveProperty("avatarUrl");
  });

  it("clears state on a network error without leaking provider details", async () => {
    setFlow();
    vi.mocked(fetch).mockRejectedValue(new Error("sensitive-provider-response"));
    const response = await callback(request());
    expect(response.headers.get("location")).toContain("auth=error");
    expect(response.headers.get("location")).not.toContain("sensitive");
    expect(response.cookies.get(AUTH_FLOW_COOKIE)?.maxAge).toBe(0);
  });

  it("requires the same signed-in Member for an explicit link", async () => {
    setFlow({ intent: "LINK", linkMemberId: memberId });
    expect((await callback(request())).headers.get("location")).toContain("auth=error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks an issued signup ticket after TikTok is disabled", async () => {
    headerMocks.get.mockReturnValue({
      value: encodeSocialSignupTicket({
        provider: "TIKTOK",
        providerSubject: "app-scoped-id",
        displayName: "TikTok 회원",
        returnTo: "/me",
        createdAt: Date.now(),
      }),
    });
    vi.stubEnv("FEATURE_TIKTOK_LOGIN_ENABLED", "false");
    const response = await signup(
      new NextRequest(`${origin}/api/auth/signup/social`, {
        method: "POST",
        headers: { "x-which-csrf": "member-auth" },
      }),
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
