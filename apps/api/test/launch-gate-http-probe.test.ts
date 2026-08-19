import { describe, expect, it } from "vitest";

import { createHttpPublicWebProbe } from "../src/modules/launch-gate/http-probe.js";

describe("Public Web HTTP probe", () => {
  it("reads the public home, Feed, and OAuth redirects without following them", async () => {
    const request: typeof fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/") {
        return Promise.resolve(
          new Response("<!doctype html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }
      if (url.pathname === "/api/issues/feed") {
        return Promise.resolve(
          Response.json({ items: [{ issueId: "issue-1" }], nextCursor: null }),
        );
      }
      const location =
        url.pathname === "/api/auth/x/start"
          ? "https://x.com/i/oauth2/authorize?client_id=hidden"
          : "https://accounts.google.com/o/oauth2/v2/auth?client_id=hidden";
      return Promise.resolve(new Response(null, { status: 307, headers: { location } }));
    };
    const probe = createHttpPublicWebProbe({
      publicWebUrl: "https://whichone.site",
      fetchImplementation: request,
    });

    await expect(probe.home()).resolves.toEqual({ statusCode: 200, isHtml: true });
    await expect(probe.feed()).resolves.toEqual({ statusCode: 200, itemCount: 1 });
    await expect(probe.googleOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "accounts.google.com",
    });
    await expect(probe.xOAuthStart()).resolves.toEqual({
      statusCode: 307,
      providerHost: "x.com",
    });
  });
});
