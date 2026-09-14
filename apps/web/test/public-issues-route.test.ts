import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, OPTIONS } from "@/app/api/public/issues/route";
import type { PublicIssueCatalog } from "@/lib/contracts";

const catalog: PublicIssueCatalog = {
  items: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      version: 1,
      question: "평생 하나만 먹어야 한다면?",
      context: "두 음식 중 하나만 고를 수 있다고 가정해 주세요.",
      contextMedia: null,
      publishedAt: "2026-09-14T00:00:00.000Z",
      categoryCode: "FOOD",
      mediaMode: "OPTION_IMAGES",
      choices: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          code: "A",
          label: "치킨",
          media: {
            url: "https://media.which.test/chicken.webp",
            altText: "바삭한 치킨",
            cropMode: "COVER",
            width: 1200,
            height: 1200,
          },
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          code: "B",
          label: "피자",
          media: {
            url: "https://media.which.test/pizza.webp",
            altText: "치즈 피자",
            cropMode: "COVER",
            width: 1200,
            height: 1200,
          },
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public content-generation Issue API", () => {
  it("returns the safe catalog through a cacheable anonymous endpoint", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json(catalog));
    vi.stubGlobal("fetch", upstream);

    const response = await GET(
      new NextRequest("https://whichone.site/api/public/issues?limit=3", {
        headers: { cookie: "which_member_session=private-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(upstream).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/issues/catalog?limit=3"),
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
      }),
    );
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
  });

  it("uses a conservative default and rejects malformed or excessive limits", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json(catalog));
    vi.stubGlobal("fetch", upstream);

    await GET(new NextRequest("https://whichone.site/api/public/issues"));
    expect(String(upstream.mock.calls[0]?.[0])).toContain("limit=100");

    for (const value of ["0", "501", "3.5", "3items", "-1"]) {
      const response = await GET(
        new NextRequest(`https://whichone.site/api/public/issues?limit=${value}`),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("does not expose upstream failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ secret: "internal detail" }, { status: 503 })),
    );

    const response = await GET(new NextRequest("https://whichone.site/api/public/issues?limit=3"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "PUBLIC_ISSUES_UNAVAILABLE",
      message: "공개 질문 목록을 불러오지 못했습니다.",
    });
  });

  it("advertises read-only cross-origin access", () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});
