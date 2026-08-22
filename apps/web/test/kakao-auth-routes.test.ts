import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headerMocks = vi.hoisted(() => ({ get: vi.fn() }));
const oidcMocks = vi.hoisted(() => ({
  discovery: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  randomState: vi.fn(),
  randomNonce: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: headerMocks.get }),
}));

vi.mock("openid-client", () => oidcMocks);

import { GET as callback } from "@/app/api/auth/kakao/callback/route";
import { GET as start } from "@/app/api/auth/kakao/start/route";
import { AUTH_FLOW_COOKIE, encodeAuthFlow } from "@/lib/server/member-auth";
import { GUEST_SUBJECT_COOKIE } from "@/lib/server/which-api";

const guestSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";

describe("Kakao OIDC routes", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("FEATURE_KAKAO_LOGIN_ENABLED", "true");
    vi.stubEnv("KAKAO_OIDC_CLIENT_ID", "kakao-client");
    vi.stubEnv("KAKAO_OIDC_CLIENT_SECRET", "kakao-secret");
    headerMocks.get.mockReset();
    Object.values(oidcMocks).forEach((mock) => mock.mockReset());
    oidcMocks.discovery.mockResolvedValue({ issuer: "https://kauth.kakao.com" });
    oidcMocks.randomPKCECodeVerifier.mockReturnValue("kakao-verifier");
    oidcMocks.calculatePKCECodeChallenge.mockResolvedValue("kakao-challenge");
    oidcMocks.randomState.mockReturnValue("kakao-state");
    oidcMocks.randomNonce.mockReturnValue("kakao-nonce");
    oidcMocks.buildAuthorizationUrl.mockImplementation((_config, parameters) => {
      const url = new URL("https://kauth.kakao.com/oauth/authorize");
      Object.entries(parameters as Record<string, string>).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set("client_id", "kakao-client");
      return url;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function flowCookie() {
    return encodeAuthFlow({
      provider: "KAKAO",
      state: "kakao-state",
      nonce: "kakao-nonce",
      codeVerifier: "kakao-verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
  }

  it("starts Kakao OIDC with PKCE, nonce, and a signed HttpOnly flow cookie", async () => {
    const response = await start(
      new Request("http://localhost:3000/api/auth/kakao/start?returnTo=/issues/issue-1"),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(location.origin + location.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: "kakao-client",
      redirect_uri: "http://localhost:3000/api/auth/kakao/callback",
      response_type: "code",
      scope: "openid",
      state: "kakao-state",
      nonce: "kakao-nonce",
      code_challenge: "kakao-challenge",
      code_challenge_method: "S256",
    });
    expect(oidcMocks.discovery).toHaveBeenCalledWith(
      new URL("https://kauth.kakao.com"),
      "kakao-client",
      "kakao-secret",
    );
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_FLOW_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain("kakao-secret");
  });

  it.each([
    { name: "credentials are missing", env: "KAKAO_OIDC_CLIENT_SECRET" },
    { name: "feature flag is off", env: "FEATURE_KAKAO_LOGIN_ENABLED" },
  ])("returns unavailable before contacting Kakao when $name", async ({ env }) => {
    vi.stubEnv(env, "");

    const response = await start(
      new Request("http://localhost:3000/api/auth/kakao/start?returnTo=/issues/issue-1"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
  });

  it("creates a WHICH session from the verified Kakao Subject", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE
        ? { value: flowCookie() }
        : name === GUEST_SUBJECT_COOKIE
          ? { value: guestSubjectId }
          : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "kakao-subject-1", nickname: "카카오 사용자" }),
    });
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/internal/member-sessions");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        provider: "KAKAO",
        providerSubject: "kakao-subject-1",
        displayName: "카카오 사용자",
      });
      return Response.json(
        { token: "which-session", expiresAt: "2026-08-23T00:00:00.000Z" },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);

    const callbackUrl =
      "http://localhost:3000/api/auth/kakao/callback?code=authorization-code&state=kakao-state";
    const response = await callback(new Request(callbackUrl));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=success#member-access",
    );
    expect(response.headers.get("set-cookie")).toContain("which_member_session=which-session");
    expect(response.headers.get("set-cookie")).toContain("which_guest_subject=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(oidcMocks.authorizationCodeGrant).toHaveBeenCalledWith(
      { issuer: "https://kauth.kakao.com" },
      new URL(callbackUrl),
      {
        pkceCodeVerifier: "kakao-verifier",
        expectedState: "kakao-state",
        expectedNonce: "kakao-nonce",
        idTokenExpected: true,
      },
    );
  });

  it("rejects a mismatched state before contacting Kakao or WHICH", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request("http://localhost:3000/api/auth/kakao/callback?code=code&state=wrong"),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/?auth=error");
    expect(oidcMocks.authorizationCodeGrant).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("returns a cancellation without exchanging a token", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/kakao/callback?error=access_denied&state=kakao-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=cancelled#member-access",
    );
    expect(oidcMocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it("does not create a session when the ID Token has no Subject", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockResolvedValue({ claims: () => ({}) });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/kakao/callback?code=authorization-code&state=kakao-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=error#member-access",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
