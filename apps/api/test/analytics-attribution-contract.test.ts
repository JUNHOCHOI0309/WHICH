import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsService } from "../src/modules/analytics/contracts.js";
import { registerAnalyticsRoutes } from "../src/modules/analytics/routes.js";

function command(attribution: Record<string, unknown>) {
  return {
    eventId: randomUUID(),
    sessionId: randomUUID(),
    eventType: "ISSUE_VIEWABLE_IMPRESSION",
    issueId: randomUUID(),
    issueVersion: 1,
    occurredAt: new Date().toISOString(),
    attribution,
  };
}

describe("Analytics acquisition attribution contract", () => {
  it("accepts coarse search and AI referrals and rejects mismatched pairs", async () => {
    const recordEvent = vi.fn(() => Promise.resolve({ accepted: true as const, duplicate: false }));
    const app = Fastify({ logger: false });
    await registerAnalyticsRoutes(
      app,
      { recordEvent } satisfies AnalyticsService,
      "analytics-test-secret",
    );
    const headers = { "x-internal-auth-secret": "analytics-test-secret" };
    const capturedAt = new Date().toISOString();

    const organic = await app.inject({
      method: "POST",
      url: "/v1/internal/analytics/events",
      headers,
      payload: command({ source: "google", medium: "organic", capturedAt }),
    });
    const ai = await app.inject({
      method: "POST",
      url: "/v1/internal/analytics/events",
      headers,
      payload: command({ source: "chatgpt", medium: "ai_referral", capturedAt }),
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/internal/analytics/events",
      headers,
      payload: command({ source: "google", medium: "ai_referral", capturedAt }),
    });

    expect(organic.statusCode).toBe(200);
    expect(ai.statusCode).toBe(200);
    expect(invalid.statusCode).toBe(400);
    expect(recordEvent).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
