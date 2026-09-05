import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as readAtomFeed } from "@/app/feed.xml/route";
import { GET as readRssFeed } from "@/app/rss.xml/route";
import { StructuredData } from "@/components/search/structured-data";
import type { PublicIssue, PublicIssueCatalog } from "@/lib/contracts";
import {
  canonicalUrl,
  issueIsIndexable,
  issueSearchDescription,
  privatePageMetadata,
} from "@/lib/search-discovery";

const issue: PublicIssue = {
  id: "10000000-0000-4000-8000-000000000001",
  version: 1,
  question: "퇴근 후 바로 잘까, 조금 더 놀까?",
  context: "오늘 하루의 마무리에서 더 가까운 선택을 골라 주세요.",
  publishedAt: "2026-08-29T00:00:00.000Z",
  categoryCode: "DAILY_LIFE",
  experienceModeCode: "CORE_VOTE",
  mediaMode: "TEXT_ONLY",
  choices: [
    { id: "choice-a", code: "A", label: "바로 자기", media: null },
    { id: "choice-b", code: "B", label: "조금 더 놀기", media: null },
  ],
  author: null,
  engagement: {
    recommendationCount: 0,
    commentCount: 0,
    viewerRecommended: false,
    viewerReported: false,
  },
  result: { visibility: "PRE_VOTE_HIDDEN", tally: null },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("search discovery foundation", () => {
  it("publishes a canonical host and separates search discovery from model training", () => {
    const value = robots();
    expect(value.sitemap).toBe("https://whichone.site/sitemap.xml");
    const searchRule = Array.isArray(value.rules)
      ? value.rules.find((rule) => rule.userAgent === "OAI-SearchBot")
      : undefined;
    expect(searchRule?.allow).toEqual(expect.arrayContaining(["/", "/api/share-cards/"]));
    expect(searchRule?.disallow).toEqual(expect.arrayContaining(["/me$", "/me/"]));
    expect(searchRule?.disallow).not.toContain("/me");
    expect(value.rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ userAgent: "GPTBot", disallow: "/" })]),
    );
  });

  it("creates spoiler-free Issue descriptions and rejects thin duplicate choices", () => {
    const description = issueSearchDescription(issue);
    expect(description).toContain("A. 바로 자기");
    expect(description).toContain("B. 조금 더 놀기");
    expect(description).not.toContain("50%");
    expect(description.length).toBeLessThanOrEqual(155);
    expect(issueIsIndexable(issue)).toBe(true);
    expect(
      issueIsIndexable({
        ...issue,
        choices: issue.choices.map((choice) => ({ ...choice, label: "같은 선택" })),
      }),
    ).toBe(false);
    expect(issueIsIndexable({ ...issue, context: null })).toBe(false);
  });

  it("marks private utility pages noindex and safely serializes JSON-LD", () => {
    expect(privatePageMetadata("내 기록").robots).toMatchObject({
      index: false,
      follow: false,
    });
    const html = renderToStaticMarkup(
      <StructuredData data={{ name: "</script><script>alert(1)</script>" }} />,
    );
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c/script>");
  });

  it("lists only canonical static and public Issue URLs in the sitemap", async () => {
    const catalogItem = {
      id: issue.id,
      version: issue.version,
      question: issue.question,
      context: issue.context,
      publishedAt: issue.publishedAt,
      categoryCode: issue.categoryCode,
      choices: issue.choices,
    };
    const catalog: PublicIssueCatalog = {
      items: [
        catalogItem,
        {
          ...catalogItem,
          id: "10000000-0000-4000-8000-000000000002",
          context: "짧음",
        },
      ],
    };
    const request = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json(catalog);
    });
    vi.stubGlobal("fetch", request);

    const entries = await sitemap();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: canonicalUrl("/") }),
        expect.objectContaining({ url: canonicalUrl(`/issues/${issue.id}`) }),
        expect.objectContaining({ url: canonicalUrl("/methodology") }),
      ]),
    );
    expect(
      entries.some((entry) => {
        const url = new URL(entry.url);
        return (
          url.searchParams.has("share") || url.pathname === "/me" || url.pathname.startsWith("/me/")
        );
      }),
    ).toBe(false);
    expect(
      entries.some(
        (entry) => entry.url === canonicalUrl("/issues/10000000-0000-4000-8000-000000000002"),
      ),
    ).toBe(false);
    expect(String(request.mock.calls[0]?.[0])).toContain("/v1/issues/catalog?limit=500");
  });

  it("publishes the full public context and choices in the Atom summary", async () => {
    const catalog: PublicIssueCatalog = {
      items: [
        {
          id: issue.id,
          version: issue.version,
          question: issue.question,
          context: issue.context,
          publishedAt: issue.publishedAt,
          categoryCode: issue.categoryCode,
          choices: issue.choices,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(catalog)),
    );

    const response = await readAtomFeed();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("application/atom+xml");
    expect(body).toContain("<author><name>WHICH Editorial</name></author>");
    expect(body).toContain(issue.context);
    expect(body).toContain("A. 바로 자기 · B. 조금 더 놀기");
    expect(body).not.toContain("recommendationRequestId");
  });

  it("publishes a Naver-compatible RSS 2.0 feed", async () => {
    const catalog: PublicIssueCatalog = {
      items: [
        {
          id: issue.id,
          version: issue.version,
          question: issue.question,
          context: issue.context,
          publishedAt: issue.publishedAt,
          categoryCode: issue.categoryCode,
          choices: issue.choices,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(catalog)),
    );

    const response = await readRssFeed();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    expect(body).toContain('<rss version="2.0">');
    expect(body).toContain("<channel>");
    expect(body).toContain(
      `<guid isPermaLink="true">${canonicalUrl(`/issues/${issue.id}`)}</guid>`,
    );
    expect(body).toContain(issue.context);
    expect(body).toContain("A. 바로 자기 · B. 조금 더 놀기");
    expect(body).not.toContain("<feed");
    expect(body).not.toContain("recommendationRequestId");
  });

  it("returns an error during a catalog outage instead of publishing empty inventory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(sitemap()).rejects.toThrow("Public Issue catalog read failed with status 503");
    await expect(readAtomFeed()).rejects.toThrow(
      "Public Issue catalog read failed with status 503",
    );
    await expect(readRssFeed()).rejects.toThrow("Public Issue catalog read failed with status 503");
  });

  it("keeps an empty Atom feed timestamp stable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [] } satisfies PublicIssueCatalog)),
    );

    const response = await readAtomFeed();
    const body = await response.text();

    expect(body).toContain("<updated>2026-08-29T00:00:00.000Z</updated>");
    expect(body).not.toContain("<entry>");
  });

  it("keeps an empty RSS feed timestamp stable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [] } satisfies PublicIssueCatalog)),
    );

    const response = await readRssFeed();
    const body = await response.text();

    expect(body).toContain(
      `<lastBuildDate>${new Date("2026-08-29T00:00:00.000Z").toUTCString()}</lastBuildDate>`,
    );
    expect(body).not.toContain("<item>");
  });
});
