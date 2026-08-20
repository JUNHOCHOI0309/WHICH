import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_SESSION_COOKIE,
  analyticsSessionForRequest,
  setAnalyticsSessionCookie,
} from "@/lib/server/analytics-session";

afterEach(() => vi.unstubAllEnvs());

function requestWithCookie(value?: string) {
  return new NextRequest("https://which.example/issues/test", {
    headers: value ? { cookie: `${ANALYTICS_SESSION_COOKIE}=${value}` } : undefined,
  });
}

describe("analytics session cookie", () => {
  it("keeps the id within 30 minutes and rotates it after inactivity", () => {
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    const startedAt = Date.parse("2026-08-20T00:00:00.000Z");
    const first = analyticsSessionForRequest(requestWithCookie(), startedAt);
    const response = NextResponse.json({ ok: true });
    setAnalyticsSessionCookie(response, first);
    const cookie = response.cookies.get(ANALYTICS_SESSION_COOKIE)?.value;

    const continued = analyticsSessionForRequest(
      requestWithCookie(cookie),
      startedAt + 29 * 60_000,
    );
    const rotated = analyticsSessionForRequest(requestWithCookie(cookie), startedAt + 31 * 60_000);

    expect(continued.id).toBe(first.id);
    expect(rotated.id).not.toBe(first.id);
  });

  it("rejects a tampered id instead of trusting it", () => {
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
    const now = Date.parse("2026-08-20T00:00:00.000Z");
    const first = analyticsSessionForRequest(requestWithCookie(), now);
    const response = NextResponse.json({ ok: true });
    setAnalyticsSessionCookie(response, first);
    const cookie = response.cookies.get(ANALYTICS_SESSION_COOKIE)?.value ?? "";
    const [payload, signature] = cookie.split(".");
    const tampered = `${payload?.replace(/.$/, payload.endsWith("a") ? "b" : "a")}.${signature}`;

    expect(analyticsSessionForRequest(requestWithCookie(tampered), now + 1).id).not.toBe(first.id);
  });
});
