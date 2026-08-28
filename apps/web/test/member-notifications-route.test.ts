import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "@/app/api/me/notifications/route";

afterEach(() => vi.unstubAllGlobals());

describe("Member notification BFF route", () => {
  it("requires a Member session", async () => {
    const response = await GET(new NextRequest("https://whichone.site/api/me/notifications"));

    expect(response.status).toBe(401);
  });

  it("forwards notification reads with only the HttpOnly Member token", async () => {
    const noticeId = "05739bff-8463-4474-a0c1-3f67ae75d586";
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/me/notifications");
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      expect(JSON.parse(String(init?.body))).toEqual({ noticeIds: [noticeId] });
      return new Response(JSON.stringify({ updated: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await PATCH(
      new NextRequest("https://whichone.site/api/me/notifications", {
        method: "PATCH",
        headers: {
          cookie: "which_member_session=member-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ noticeIds: [noticeId] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1 });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
