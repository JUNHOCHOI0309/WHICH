import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeOidcFlow,
  encodeOidcFlow,
  internalAuthSecret,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";

describe("Member OIDC return flow", () => {
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
    const encoded = encodeOidcFlow({
      state: "state",
      nonce: "nonce",
      codeVerifier: "verifier",
      returnTo: "/issues/issue-1#member-access",
      createdAt: Date.now(),
    });
    expect(decodeOidcFlow(encoded)).toMatchObject({
      state: "state",
      returnTo: "/issues/issue-1#member-access",
    });
    expect(decodeOidcFlow(`${encoded}tampered`)).toBeNull();
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
