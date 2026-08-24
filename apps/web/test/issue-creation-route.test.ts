import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/issues/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Member Issue creation BFF", () => {
  it("requires the HttpOnly Member session", async () => {
    const response = await POST(
      new NextRequest("https://whichone.site/api/issues", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "6e14418f-1c9e-426f-9e09-8420f8b84ab7",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("forwards the session, request key, and body to the API", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/issues");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer member-token");
      expect(headers.get("idempotency-key")).toBe("6e14418f-1c9e-426f-9e09-8420f8b84ab7");
      expect(JSON.parse(String(init?.body))).toMatchObject({ question: "오늘 뭐 먹을까?" });
      return new Response(JSON.stringify({ created: true, issue: { id: "issue-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await POST(
      new NextRequest("https://whichone.site/api/issues", {
        method: "POST",
        headers: {
          cookie: "which_member_session=member-token",
          "content-type": "application/json",
          "idempotency-key": "6e14418f-1c9e-426f-9e09-8420f8b84ab7",
        },
        body: JSON.stringify({ question: "오늘 뭐 먹을까?" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, issue: { id: "issue-1" } });
  });
});
