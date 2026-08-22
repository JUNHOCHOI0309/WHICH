import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PATCH as updateMeProfile } from "@/app/api/me/profile/route";
import { GET as readCreatorProfile } from "@/app/api/profiles/[handle]/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creator profile BFF routes", () => {
  it("forwards profile changes with the HttpOnly Member session", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/me/profile");
      expect(init?.method).toBe("PATCH");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-token");
      expect(JSON.parse(String(init?.body))).toEqual({
        handle: "question_maker",
        bio: "좋은 질문을 만듭니다.",
        visibility: "PUBLIC",
      });
      return new Response(
        JSON.stringify({
          handle: "question_maker",
          bio: "좋은 질문을 만듭니다.",
          visibility: "PUBLIC",
          publicUrl: "/user/question_maker",
        }),
      );
    });
    vi.stubGlobal("fetch", upstream);

    const response = await updateMeProfile(
      new NextRequest("https://whichone.site/api/me/profile", {
        method: "PATCH",
        headers: {
          cookie: "which_member_session=member-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          handle: "question_maker",
          bio: "좋은 질문을 만듭니다.",
          visibility: "PUBLIC",
        }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("reads a public profile without forwarding private identity", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:4000/v1/profiles/creator_one");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(JSON.stringify({ creator: { handle: "creator_one" } }));
    });
    vi.stubGlobal("fetch", upstream);

    const response = await readCreatorProfile(
      new NextRequest("https://whichone.site/api/profiles/creator_one"),
      { params: Promise.resolve({ handle: "creator_one" }) },
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
