import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { analyticsContextForRequest } from "@/lib/server/analytics-context";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics session context", () => {
  it("reduces request data to coarse product segments", () => {
    const request = new NextRequest("https://whichone.site/api/analytics/events", {
      headers: {
        cookie: "which_member_session=opaque-token",
        referer: "https://whichone.site/",
        "user-agent": "Mozilla/5.0 (Linux; Android 15; Mobile)",
        "sec-ch-ua-mobile": "?1",
      },
    });

    expect(analyticsContextForRequest(request, false)).toEqual({
      entrySurface: "HOME",
      audienceSegment: "MEMBER",
      deviceSegment: "MOBILE",
      trafficClass: "PRODUCT",
    });
  });

  it("marks bots and only honors operator exclusion with the server secret", () => {
    vi.stubEnv("ANALYTICS_EXCLUSION_SECRET", "separate-operator-secret");
    const bot = new NextRequest("https://whichone.site/api/analytics/events", {
      headers: { "user-agent": "Googlebot/2.1" },
    });
    expect(analyticsContextForRequest(bot, false).trafficClass).toBe("BOT");

    const invalid = new NextRequest("https://whichone.site/api/analytics/events", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "x-which-analytics-traffic-class": "OPERATOR",
        "x-which-analytics-exclusion-secret": "wrong",
      },
    });
    expect(analyticsContextForRequest(invalid, false).trafficClass).toBe("PRODUCT");

    const operator = new NextRequest("https://whichone.site/api/analytics/events", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "x-which-analytics-traffic-class": "OPERATOR",
        "x-which-analytics-exclusion-secret": "separate-operator-secret",
      },
    });
    expect(analyticsContextForRequest(operator, true)).toMatchObject({
      entrySurface: "EXTERNAL",
      trafficClass: "OPERATOR",
    });
  });
});
