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
  customFetch: Symbol("openid-client.customFetch"),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: headerMocks.get }),
}));

vi.mock("openid-client", () => oidcMocks);

import { GET as callback } from "@/app/api/auth/google/callback/route";
import { GET as handoff } from "@/app/api/auth/google/handoff/route";
import { GET as start } from "@/app/api/auth/google/start/route";
import {
  AUTH_FLOW_COOKIE,
  decodeAuthFlow,
  encodeAuthFlow,
  encodeGoogleBrowserHandoff,
} from "@/lib/server/member-auth";
import { googleTokenRequestBody } from "@/lib/server/google-oauth";
import { GUEST_SUBJECT_COOKIE } from "@/lib/server/which-api";

const guestSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";

describe("Google OIDC routes", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("GOOGLE_OIDC_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_OIDC_CLIENT_SECRET", "google-secret");
    headerMocks.get.mockReset();
    Object.values(oidcMocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
    oidcMocks.discovery.mockResolvedValue({ issuer: "https://accounts.google.com" });
    oidcMocks.randomPKCECodeVerifier.mockReturnValue("google-verifier");
    oidcMocks.calculatePKCECodeChallenge.mockResolvedValue("google-challenge");
    oidcMocks.randomState.mockReturnValue("google-state");
    oidcMocks.randomNonce.mockReturnValue("google-nonce");
    oidcMocks.buildAuthorizationUrl.mockImplementation((_config, parameters) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      Object.entries(parameters as Record<string, string>).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set("client_id", "google-client");
      return url;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a normal browser at Google with a browser-bound signed flow", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === GUEST_SUBJECT_COOKIE ? { value: guestSubjectId } : undefined,
    );

    const response = await start(
      new Request(
        "https://whichone.site/api/auth/google/start?returnTo=/issues/issue-1%23member-access",
        { headers: { "user-agent": "Mozilla/5.0 Chrome/140 Mobile Safari/537.36" } },
      ),
    );
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: "google-client",
      redirect_uri: "https://whichone.site/api/auth/google/callback",
      state: "google-state",
      nonce: "google-nonce",
      code_challenge: "google-challenge",
      code_challenge_method: "S256",
    });
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_FLOW_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("pins the public callback URI during Google token exchange", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "http://127.0.0.1:10000/api/auth/google/callback",
    });
    const forwarded = googleTokenRequestBody(
      body,
      "https://whichone.site/api/auth/google/callback",
    );

    expect(forwarded).toBeInstanceOf(URLSearchParams);
    expect((forwarded as URLSearchParams).get("redirect_uri")).toBe(
      "https://whichone.site/api/auth/google/callback",
    );
    expect(body.get("redirect_uri")).toBe("http://127.0.0.1:10000/api/auth/google/callback");
  });

  it("keeps KakaoTalk away from Google and offers an opaque Chrome handoff", async () => {
    headerMocks.get.mockImplementation((name: string) =>
      name === GUEST_SUBJECT_COOKIE ? { value: guestSubjectId } : undefined,
    );

    const response = await start(
      new Request("https://whichone.site/api/auth/google/start?returnTo=/issues/issue-1", {
        headers: { "user-agent": "Mozilla/5.0 KAKAOTALK 2610010" },
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html).toContain("Chrome에서 Google 로그인을 계속해 주세요");
    expect(html).toContain("intent://whichone.site/api/auth/google/handoff?ticket=");
    expect(html).not.toContain(guestSubjectId);
    expect(html).not.toContain("google-secret");
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
  });

  it("creates a fresh state, PKCE verifier, nonce, and flow cookie after handoff", async () => {
    const ticket = encodeGoogleBrowserHandoff({
      returnTo: "/issues/issue-1#member-access",
      anonymousSubjectId: guestSubjectId,
      state: "handoff-state-value-with-at-least-32-characters",
      nonce: "handoff-nonce-value-with-at-least-32-characters",
      codeVerifier: "handoff-code-verifier-with-at-least-forty-three-characters",
      createdAt: Date.now(),
    });

    const response = await handoff(
      new Request(
        `https://whichone.site/api/auth/google/handoff?ticket=${encodeURIComponent(ticket)}`,
        { headers: { "user-agent": "Mozilla/5.0 Chrome/140 Mobile Safari/537.36" } },
      ),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    const encodedFlow = new RegExp(`${AUTH_FLOW_COOKIE}=([^;]+)`).exec(setCookie)?.[1];

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("https://accounts.google.com/");
    expect(decodeAuthFlow(encodedFlow)).toMatchObject({
      provider: "GOOGLE",
      state: "handoff-state-value-with-at-least-32-characters",
      nonce: "handoff-nonce-value-with-at-least-32-characters",
      codeVerifier: "handoff-code-verifier-with-at-least-forty-three-characters",
      anonymousSubjectId: guestSubjectId,
    });
  });

  it("keeps duplicate external-browser handoffs on the same OAuth flow", async () => {
    const ticket = encodeGoogleBrowserHandoff({
      returnTo: "/issues/issue-1#member-access",
      anonymousSubjectId: guestSubjectId,
      state: "duplicate-state-value-with-at-least-32-characters",
      nonce: "duplicate-nonce-value-with-at-least-32-characters",
      codeVerifier: "duplicate-code-verifier-with-at-least-forty-three-characters",
      createdAt: Date.now(),
    });
    const request = () =>
      new Request(
        `https://whichone.site/api/auth/google/handoff?ticket=${encodeURIComponent(ticket)}`,
        { headers: { "user-agent": "Mozilla/5.0 Chrome/140 Mobile Safari/537.36" } },
      );

    const first = await handoff(request());
    const second = await handoff(request());
    const flowCookie = (response: Response) => {
      const setCookie = response.headers.get("set-cookie") ?? "";
      return decodeAuthFlow(new RegExp(`${AUTH_FLOW_COOKIE}=([^;]+)`).exec(setCookie)?.[1]);
    };

    expect(first.headers.get("location")).toBe(second.headers.get("location"));
    expect(flowCookie(first)).toMatchObject({
      state: "duplicate-state-value-with-at-least-32-characters",
      nonce: "duplicate-nonce-value-with-at-least-32-characters",
      codeVerifier: "duplicate-code-verifier-with-at-least-forty-three-characters",
    });
    expect(flowCookie(second)).toMatchObject({
      state: "duplicate-state-value-with-at-least-32-characters",
      nonce: "duplicate-nonce-value-with-at-least-32-characters",
      codeVerifier: "duplicate-code-verifier-with-at-least-forty-three-characters",
    });
  });

  it("rejects a modified handoff before contacting Google", async () => {
    const response = await handoff(
      new Request("https://whichone.site/api/auth/google/handoff?ticket=v1.modified.ticket.value", {
        headers: { "user-agent": "Mozilla/5.0 Chrome/140 Mobile Safari/537.36" },
      }),
    );

    expect(response.headers.get("location")).toBe("https://whichone.site/?auth=error");
    expect(oidcMocks.discovery).not.toHaveBeenCalled();
  });

  it("links the original Guest Subject after Google returns in the external browser", async () => {
    const flow = encodeAuthFlow({
      provider: "GOOGLE",
      state: "google-state",
      nonce: "google-nonce",
      codeVerifier: "google-verifier",
      returnTo: "/issues/issue-1#member-access",
      anonymousSubjectId: guestSubjectId,
      createdAt: Date.now(),
    });
    headerMocks.get.mockImplementation((name: string) =>
      name === AUTH_FLOW_COOKIE ? { value: flow } : undefined,
    );
    oidcMocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "google-subject-1", name: "테스트 회원" }),
    });
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        provider: "GOOGLE",
        providerSubject: "google-subject-1",
        anonymousSubjectId: guestSubjectId,
      });
      return Response.json(
        { token: "which-session", expiresAt: "2026-08-22T00:00:00.000Z" },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);

    const response = await callback(
      new Request(
        "https://whichone.site/api/auth/google/callback?code=authorization-code&state=google-state",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://whichone.site/issues/issue-1?auth=success#member-access",
    );
    expect(response.headers.get("set-cookie")).toContain("which_member_session=which-session");
    expect(response.headers.get("set-cookie")).toContain(`which_guest_subject=${guestSubjectId}`);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
