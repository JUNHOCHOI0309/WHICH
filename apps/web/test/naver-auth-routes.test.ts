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

import { GET as callback } from "@/app/api/auth/naver/callback/route";
import { GET as start } from "@/app/api/auth/naver/start/route";
import { AUTH_FLOW_COOKIE, encodeAuthFlow } from "@/lib/server/member-auth";

describe("Naver OIDC routes", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("FEATURE_NAVER_LOGIN_ENABLED", "true");
    vi.stubEnv("NAVER_OIDC_CLIENT_ID", "naver-client");
    vi.stubEnv("NAVER_OIDC_CLIENT_SECRET", "naver-secret");
    headerMocks.get.mockReset();
    Object.values(oidcMocks).forEach((mock) => mock.mockReset());
    oidcMocks.discovery.mockResolvedValue({ issuer: "https://nid.naver.com" });
    oidcMocks.randomPKCECodeVerifier.mockReturnValue("naver-verifier");
    oidcMocks.calculatePKCECodeChallenge.mockResolvedValue("naver-challenge");
    oidcMocks.randomState.mockReturnValue("naver-state");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    oidcMocks.buildAuthorizationUrl.mockImplementation((_config, parameters) => {
      const url = new URL("https://nid.naver.com/oauth2/authorize");
      Object.entries(parameters as Record<string, string>).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set("client_id", "naver-client");
      return url;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function flowCookie() {
    return encodeAuthFlow({
      provider: "NAVER",
      state: "naver-state",
      codeVerifier: "naver-verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
  }

  it("starts at Naver with OIDC, PKCE, state, and a signed HttpOnly flow cookie", async () => {
    const response = await start(
      new Request("http://localhost:3000/api/auth/naver/start?returnTo=/issues/issue-1"),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(location.origin + location.pathname).toBe("https://nid.naver.com/oauth2/authorize");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: "naver-client",
      redirect_uri: "http://localhost:3000/api/auth/naver/callback",
      response_type: "code",
      scope: "openid",
      state: "naver-state",
      code_challenge: "naver-challenge",
      code_challenge_method: "S256",
    });
    expect(location.searchParams.has("nonce")).toBe(false);
    expect(oidcMocks.discovery).toHaveBeenCalledWith(
      new URL("https://nid.naver.com"),
      "naver-client",
      "naver-secret",
    );
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_FLOW_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain("naver-secret");
  });

  it("returns to the app when Naver credentials are unavailable", async () => {
    vi.stubEnv("NAVER_OIDC_CLIENT_SECRET", "");

    const response = await start(
      new Request("http://localhost:3000/api/auth/naver/start?returnTo=/issues/issue-1"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
  });

  it("keeps the Naver route unavailable while the production feature flag is off", async () => {
    vi.stubEnv("FEATURE_NAVER_LOGIN_ENABLED", "false");

    const response = await start(
      new Request("http://localhost:3000/api/auth/naver/start?returnTo=/issues/issue-1"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
  });

  it("does not exchange a callback code after the Naver feature flag is turned off", async () => {
    vi.stubEnv("FEATURE_NAVER_LOGIN_ENABLED", "false");
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/naver/callback?code=authorization-code&state=naver-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=error#member-access",
    );
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
    expect(oidcMocks.authorizationCodeGrant).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("creates a WHICH session from the verified Naver pairwise Subject", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "naver-subject-1" }),
    });
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("http://localhost:4000/v1/internal/member-sessions");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        provider: "NAVER",
        providerSubject: "naver-subject-1",
        displayName: "네이버 회원",
      });
      return Response.json(
        { token: "which-session", expiresAt: "2026-08-21T00:00:00.000Z" },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);

    const callbackUrl =
      "http://localhost:3000/api/auth/naver/callback?code=authorization-code&state=naver-state";
    const response = await callback(new Request(callbackUrl));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=success#member-access",
    );
    expect(response.headers.get("set-cookie")).toContain("which_member_session=which-session");
    expect(oidcMocks.authorizationCodeGrant).toHaveBeenCalledWith(
      { issuer: "https://nid.naver.com" },
      new URL(callbackUrl),
      {
        pkceCodeVerifier: "naver-verifier",
        expectedState: "naver-state",
        idTokenExpected: true,
      },
      { state: "naver-state" },
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched state before contacting Naver or the WHICH API", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request("http://localhost:3000/api/auth/naver/callback?code=code&state=wrong"),
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
        "http://localhost:3000/api/auth/naver/callback?error=access_denied&state=naver-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=cancelled#member-access",
    );
    expect(oidcMocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it("does not create a session when the verified ID Token has no Subject", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockResolvedValue({ claims: () => ({}) });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/naver/callback?code=authorization-code&state=naver-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=error#member-access",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("logs only the safe failure stage when the Naver token exchange fails", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flowCookie() } : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockRejectedValue(
      Object.assign(new Error("sensitive authorization code must not be logged"), {
        code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
      }),
    );
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request(
        "http://localhost:3000/api/auth/naver/callback?code=authorization-code&state=naver-state",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/issues/issue-1?auth=error#member-access",
    );
    expect(console.warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: "naver_auth_failed",
        stage: "token_exchange",
        errorName: "Error",
        errorCode: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
      }),
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "sensitive authorization code",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
