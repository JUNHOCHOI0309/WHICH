import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authFlowMatches,
  decodeAuthFlow,
  decodeGoogleBrowserHandoff,
  encodeAuthFlow,
  encodeGoogleBrowserHandoff,
  internalAuthSecret,
  isEmbeddedUserAgent,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";

describe("Member OAuth return flow", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps only same-origin application return paths", () => {
    expect(sanitizeReturnTo("/issues/issue-1?draft=kept#member-access")).toBe(
      "/issues/issue-1?draft=kept#member-access",
    );
    expect(sanitizeReturnTo("https://attacker.example/steal")).toBe("/");
    expect(sanitizeReturnTo("//attacker.example/steal")).toBe("/");
    expect(sanitizeReturnTo("/api/auth/google/start")).toBe("/");
  });

  it("signs flow state and rejects a modified cookie", () => {
    const encoded = encodeAuthFlow({
      provider: "GOOGLE",
      state: "state",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
    expect(decodeAuthFlow(encoded)).toMatchObject({
      provider: "GOOGLE",
      state: "state",
      returnTo: "/issues/issue-1#member-access",
    });
    expect(decodeAuthFlow(`${encoded}tampered`)).toBeNull();
  });

  it("recognizes embedded browsers that cannot safely complete Google OAuth", () => {
    expect(isEmbeddedUserAgent("Mozilla/5.0 KAKAOTALK 2610010")).toBe(true);
    expect(isEmbeddedUserAgent("Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36")).toBe(
      true,
    );
    expect(isEmbeddedUserAgent("Mozilla/5.0 Chrome/140.0.0.0 Mobile Safari/537.36")).toBe(false);
  });

  it("encrypts, expires, and authenticates a Google external-browser handoff", () => {
    const createdAt = Date.now();
    const anonymousSubjectId = "591f2e90-996a-50c5-af46-967dd0793000";
    const encoded = encodeGoogleBrowserHandoff({
      returnTo: "/issues/issue-1#member-access",
      anonymousSubjectId,
      state: "s".repeat(32),
      nonce: "n".repeat(32),
      codeVerifier: "v".repeat(43),
      createdAt,
    });

    expect(encoded).not.toContain(anonymousSubjectId);
    expect(decodeGoogleBrowserHandoff(encoded, createdAt + 1_000)).toMatchObject({
      provider: "GOOGLE",
      returnTo: "/issues/issue-1#member-access",
      anonymousSubjectId,
    });
    expect(decodeGoogleBrowserHandoff(`${encoded}tampered`, createdAt + 1_000)).toBeNull();
    expect(decodeGoogleBrowserHandoff(encoded, createdAt + 2 * 60 * 1_000 + 1)).toBeNull();
  });

  it("binds the signed flow to its Provider and returned state", () => {
    const encoded = encodeAuthFlow({
      provider: "X",
      state: "x-state",
      codeVerifier: "verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
    const flow = decodeAuthFlow(encoded);

    expect(flow && authFlowMatches(flow, "X", "x-state")).toBe(true);
    expect(flow && authFlowMatches(flow, "GOOGLE", "x-state")).toBe(false);
    expect(flow && authFlowMatches(flow, "X", "wrong-state")).toBe(false);
  });

  it("accepts a signed Naver OIDC flow only when its nonce is present", () => {
    const valid = encodeAuthFlow({
      provider: "NAVER",
      state: "naver-state",
      nonce: "naver-nonce",
      codeVerifier: "verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
    const missingNonce = encodeAuthFlow({
      provider: "NAVER",
      state: "naver-state",
      codeVerifier: "verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });

    expect(decodeAuthFlow(valid)).toMatchObject({ provider: "NAVER", nonce: "naver-nonce" });
    expect(decodeAuthFlow(missingNonce)).toBeNull();
  });

  it("adds the auth outcome without losing query or hash state", () => {
    expect(withAuthOutcome("/issues/issue-1?draft=kept#member-access", "cancelled")).toBe(
      "/issues/issue-1?draft=kept&auth=cancelled#member-access",
    );
  });

  it("shares the API internal secret in a single-service deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    vi.stubEnv("INTERNAL_AUTH_SECRET", "shared-render-internal-secret");

    expect(internalAuthSecret()).toBe("shared-render-internal-secret");
  });
});
