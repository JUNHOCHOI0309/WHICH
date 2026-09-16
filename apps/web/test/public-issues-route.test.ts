import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, OPTIONS } from "@/app/api/public/issues/route";
import { GET as GET_INDEXABLE, OPTIONS as OPTIONS_INDEXABLE } from "@/app/public/issues.json/route";
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

function catalogFetch(value: PublicIssueCatalog = catalog, completedIssueIds: string[] = []) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    return url.hostname === "studio.whichone.site"
      ? Response.json({ issueIds: completedIssueIds })
      : Response.json(value);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public content-generation Issue API", () => {
  it("returns the safe catalog through a cacheable anonymous endpoint", async () => {
    const upstream = catalogFetch();
    vi.stubGlobal("fetch", upstream);

    const response = await GET(
      new NextRequest("https://whichone.site/api/public/issues?limit=3", {
        headers: { cookie: "which_member_session=private-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(upstream).toHaveBeenCalledWith(
      new URL("http://localhost:4000/v1/issues/catalog?limit=500"),
      expect.objectContaining({
        cache: "no-store",
        headers: { accept: "application/json" },
      }),
    );
    expect(upstream).toHaveBeenCalledWith(
      "https://studio.whichone.site/api/public/completions",
      expect.objectContaining({ cache: "no-store", headers: { accept: "application/json" } }),
    );
    const catalogCall = upstream.mock.calls.find(([input]) =>
      String(input).includes("/v1/issues/catalog"),
    );
    expect(new Headers(catalogCall?.[1]?.headers).has("authorization")).toBe(false);
  });

  it("excludes completed Studio questions before applying the requested limit", async () => {
    const completed = catalog.items[0]!;
    const available: (typeof catalog.items)[number] = {
      ...completed,
      id: "10000000-0000-4000-8000-000000000002",
      question: "다음 질문",
    };
    vi.stubGlobal("fetch", catalogFetch({ items: [completed, available] }, [completed.id]));

    const response = await GET(new NextRequest("https://whichone.site/api/public/issues?limit=1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [available] });
  });

  it("uses a conservative default and rejects malformed or excessive limits", async () => {
    const upstream = catalogFetch();
    vi.stubGlobal("fetch", upstream);

    await GET(new NextRequest("https://whichone.site/api/public/issues"));
    expect(upstream.mock.calls.some(([input]) => String(input).includes("limit=500"))).toBe(true);

    for (const value of ["0", "501", "3.5", "3items", "-1"]) {
      const response = await GET(
        new NextRequest(`https://whichone.site/api/public/issues?limit=${value}`),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("does not expose upstream failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        String(input).includes("studio.whichone.site")
          ? Response.json({ issueIds: [] })
          : Response.json({ secret: "internal detail" }, { status: 503 }),
      ),
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

  it("serves the same catalog from the indexable non-API path", async () => {
    const upstream = catalogFetch();
    vi.stubGlobal("fetch", upstream);

    const response = await GET_INDEXABLE(
      new NextRequest("https://whichone.site/public/issues.json?limit=3"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get("content-language")).toBe("ko");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(OPTIONS_INDEXABLE().status).toBe(204);
  });
});
