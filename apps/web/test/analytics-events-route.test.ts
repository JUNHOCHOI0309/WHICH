import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/analytics/events/route";

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
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: true, duplicate: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
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
  });
});
