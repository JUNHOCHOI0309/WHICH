import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/analytics/events/route";
import { encodeEntryAttribution, ENTRY_ATTRIBUTION_COOKIE } from "@/lib/server/entry-attribution";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web Analytics BFF", () => {
  it("falls back to the Render INTERNAL_AUTH_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    vi.stubEnv("INTERNAL_AUTH_SECRET", "shared-render-internal-secret");
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ accepted: true, duplicate: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", request);

    const response = await POST(
      new NextRequest("https://whichone.site/api/analytics/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          eventType: "VOTE_SUBMIT",
          issueId: "591f2e90-996a-50c5-af46-967dd0793000",
          issueVersion: 1,
          occurredAt: "2026-08-21T00:00:00.000Z",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/internal/analytics/events"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-internal-auth-secret": "shared-render-internal-secret",
        }),
      }),
    );
    const forwarded = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(forwarded).toMatchObject({
      eventType: "VOTE_SUBMIT",
    });
    expect(forwarded).not.toHaveProperty("quality");
  });

  it("forwards structured quality fields and strips unknown client properties", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("INTERNAL_AUTH_SECRET", "shared-render-internal-secret");
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ accepted: true, duplicate: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", request);
    await POST(
      new NextRequest("https://whichone.site/api/analytics/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          eventType: "VOTE_SUBMIT",
          issueId: "591f2e90-996a-50c5-af46-967dd0793000",
          issueVersion: 1,
          occurredAt: "2026-08-21T00:00:00.000Z",
          quality: {
            durationMs: 1200,
            canonicalChoiceId: "92661a6f-76a6-5ef7-aa91-72703b2b343e",
            shownPosition: 0,
            mediaMode: "TEXT_ONLY",
          },
          memberId: "must-not-leave-the-bff",
          originalImageUrl: "must-not-leave-the-bff",
        }),
      }),
    );
    const forwarded = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(forwarded).toMatchObject({
      eventType: "VOTE_SUBMIT",
      quality: {
        durationMs: 1200,
        canonicalChoiceId: "92661a6f-76a6-5ef7-aa91-72703b2b343e",
        shownPosition: 0,
        mediaMode: "TEXT_ONLY",
      },
    });
    expect(forwarded).not.toHaveProperty("memberId");
    expect(forwarded).not.toHaveProperty("originalImageUrl");
  });

  it("forwards only coarse AI acquisition fields from the signed first-party cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    vi.stubEnv("INTERNAL_AUTH_SECRET", "shared-render-internal-secret");
    const capturedAt = Date.now();
    const cookie = encodeEntryAttribution({
      version: 1,
      source: "chatgpt",
      medium: "ai_referral",
      capturedAt,
    });
    const request = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Promise.resolve(Response.json({ accepted: true, duplicate: false }, { status: 200 }));
    });
    vi.stubGlobal("fetch", request);

    await POST(
      new NextRequest("https://whichone.site/api/analytics/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ENTRY_ATTRIBUTION_COOKIE}=${cookie}`,
        },
        body: JSON.stringify({
          eventId: "93831fba-b70f-598a-88f6-92eb4f70df9c",
          eventType: "ISSUE_VIEWABLE_IMPRESSION",
          issueId: "591f2e90-996a-50c5-af46-967dd0793000",
          issueVersion: 1,
          occurredAt: "2026-08-29T00:00:00.000Z",
          referrer: "https://chatgpt.com/c/private",
          searchQuery: "must-not-leave-the-bff",
        }),
      }),
    );

    const forwarded = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(forwarded.attribution).toEqual({
      source: "chatgpt",
      medium: "ai_referral",
      capturedAt: new Date(capturedAt).toISOString(),
    });
    expect(forwarded).not.toHaveProperty("referrer");
    expect(forwarded).not.toHaveProperty("searchQuery");
  });
});
