import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as startMobileAuth } from "@/app/api/mobile-auth/start/route";
import { GET as completeMobileAuth } from "@/app/mobile-auth/complete/route";
import {
  mobileAuthCallbackUrl,
  mobileAuthCompletionPath,
  readMobileAuthRequest,
} from "@/lib/server/mobile-auth";

const authRequest = {
  state: "s".repeat(32),
  nonce: "n".repeat(32),
  codeChallenge: "c".repeat(43),
  provider: "email" as const,
};

function authUrl(path: string) {
  const url = new URL(path, "https://whichone.site");
  url.searchParams.set("state", authRequest.state);
  url.searchParams.set("nonce", authRequest.nonce);
  url.searchParams.set("code_challenge", authRequest.codeChallenge);
  url.searchParams.set("provider", authRequest.provider);
  return url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Native authentication bridge", () => {
  it("accepts only fixed-size proof and builds a fixed app callback", () => {
    expect(readMobileAuthRequest(authUrl("/").searchParams)).toEqual(authRequest);
    expect(readMobileAuthRequest(new URLSearchParams({ state: "short" }))).toBeNull();
    expect(mobileAuthCompletionPath(authRequest)).toContain("/mobile-auth/complete?");
    expect(mobileAuthCallbackUrl(authRequest, { ticket: "t".repeat(43) }).toString()).toContain(
      "which://auth/callback?",
    );
  });

  it("canonicalizes a valid app request and sends an unauthenticated browser to login", async () => {
    const started = await startMobileAuth(new NextRequest(authUrl("/api/mobile-auth/start")));
    expect(started.status).toBe(307);
    expect(started.headers.get("location")).toContain("/mobile-auth/complete?");

    const completed = await completeMobileAuth(new NextRequest(authUrl("/mobile-auth/complete")));
    const login = new URL(completed.headers.get("location") ?? "");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("returnTo")).toContain("/mobile-auth/complete?");
  });

  it("starts the selected social Provider and returns cancellation to the fixed app callback", async () => {
    const socialUrl = authUrl("/mobile-auth/complete");
    socialUrl.searchParams.set("provider", "kakao");
    socialUrl.searchParams.set("phase", "start");
    const started = await completeMobileAuth(new NextRequest(socialUrl));
    const provider = new URL(started.headers.get("location") ?? "");
    expect(provider.pathname).toBe("/api/auth/kakao/start");
    expect(provider.searchParams.get("returnTo")).toContain("phase=callback");

    socialUrl.searchParams.set("phase", "callback");
    socialUrl.searchParams.set("auth", "cancelled");
    const cancelled = await completeMobileAuth(new NextRequest(socialUrl));
    const callback = new URL(cancelled.headers.get("location") ?? "");
    expect(callback.toString()).toContain("which://auth/callback?");
    expect(callback.searchParams.get("error")).toBe("provider_cancelled");
  });

  it("mints a ticket with the Cookie session and redirects only to the app scheme", async () => {
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer web-session");
      expect(JSON.parse(String(init?.body))).toEqual({
        state: authRequest.state,
        nonce: authRequest.nonce,
        codeChallenge: authRequest.codeChallenge,
      });
      return new Response(
        JSON.stringify({ ticket: "t".repeat(43), expiresAt: "2026-08-27T01:00:00.000Z" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", upstream);

    const completed = await completeMobileAuth(
      new NextRequest(authUrl("/mobile-auth/complete"), {
        headers: { cookie: "which_member_session=web-session" },
      }),
    );
    const callback = new URL(completed.headers.get("location") ?? "");
    expect(callback.protocol).toBe("which:");
    expect(callback.host).toBe("auth");
    expect(callback.pathname).toBe("/callback");
    expect(callback.searchParams.get("ticket")).toBe("t".repeat(43));
    expect(callback.searchParams.get("state")).toBe(authRequest.state);
  });
});
