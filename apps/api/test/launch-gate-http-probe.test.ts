import { describe, expect, it } from "vitest";

import { createHttpPublicWebProbe } from "../src/modules/launch-gate/http-probe.js";

describe("Public Web HTTP probe", () => {
  it("reads public Web, mobile, credential, legal, and OAuth surfaces", async () => {
    const request: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(new Headers(init?.headers).get("cookie")).toBe(
        "which_guest_subject=00000000-0000-4000-8000-000000000051",
      );
      if (
        [
          "/",
          "/login",
          "/signup",
          "/forgot-password",
          "/me",
          "/legal/privacy",
          "/legal/terms",
          "/issues/issue-1",
        ].includes(url.pathname)
      ) {
        return Promise.resolve(
          new Response("<!doctype html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }
      if (["/api/issues/feed", "/api/mobile/v1/issues/feed"].includes(url.pathname)) {
        const issueId = url.searchParams.has("excludeIssueId") ? "issue-2" : "issue-1";
        return Promise.resolve(Response.json({ items: [{ id: issueId }], nextCursor: null }));
      }
      const locations: Record<string, string> = {
        "/api/auth/google/start": "https://accounts.google.com/o/oauth2/v2/auth?client_id=hidden",
        "/api/auth/x/start": "https://x.com/i/oauth2/authorize?client_id=hidden",
        "/api/auth/naver/start": "https://nid.naver.com/oauth2.0/authorize?client_id=hidden",
        "/api/auth/kakao/start": "https://kauth.kakao.com/oauth/authorize?client_id=hidden",
      };
      const location = locations[url.pathname];
      if (!location) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(new Response(null, { status: 307, headers: { location } }));
    };
    const probe = createHttpPublicWebProbe({
      publicWebUrl: "https://whichone.site",
      fetchImplementation: request,
    });

    await expect(probe.home()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.feed()).resolves.toEqual({ statusCode: 200, itemCount: 1 });
    await expect(probe.issueDeepLink()).resolves.toEqual({
      statusCode: 200,
      isHtml: true,
      issueId: "issue-1",
    });
    await expect(probe.nextIssue()).resolves.toEqual({
      statusCode: 200,
      itemCount: 1,
      excludedIssueId: "issue-1",
      returnedIssueId: "issue-2",
    });
    await expect(probe.mobileFeed()).resolves.toEqual({ statusCode: 200, itemCount: 1 });
    await expect(probe.login()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.signup()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.passwordRecovery()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.memberCenter()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.privacyPolicy()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.termsOfService()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.googleOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "accounts.google.com",
    });
    await expect(probe.xOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "x.com",
    });
    await expect(probe.naverOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "nid.naver.com",
    });
    await expect(probe.kakaoOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "kauth.kakao.com",
    });
  });
});
