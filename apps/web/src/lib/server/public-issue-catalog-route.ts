import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

const DEFAULT_LIMIT = 100;
const MAXIMUM_LIMIT = 500;
const DEFAULT_COMPLETIONS_URL = "https://studio.whichone.site/api/public/completions";
const publicHeaders = {
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Language": "ko",
  "X-Content-Type-Options": "nosniff",
};

function responseHeaders(cacheControl: string) {
  return { ...publicHeaders, "Cache-Control": cacheControl };
}

function parseLimit(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("limit");
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) return null;

  const limit = Number(value);
  return limit >= 1 && limit <= MAXIMUM_LIMIT ? limit : null;
}

function completionIds(value: unknown) {
  if (typeof value !== "object" || value === null || !("issueIds" in value)) return null;
  const issueIds = (value as { issueIds?: unknown }).issueIds;
  if (!Array.isArray(issueIds) || issueIds.length > 10_000) return null;
  if (
    !issueIds.every(
      (id) =>
        typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id),
    )
  ) {
    return null;
  }
  return new Set(issueIds);
}

async function readCompletedIssueIds() {
  const configured = process.env.MARKETING_STUDIO_COMPLETIONS_URL?.trim();
  const response = await fetch(configured || DEFAULT_COMPLETIONS_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Content Studio completions returned ${response.status}.`);
  const ids = completionIds(await response.json());
  if (!ids) throw new Error("Content Studio completions returned an invalid payload.");
  return ids;
}

export function publicIssueCatalogOptions() {
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders("public, max-age=86400"),
  });
}

export async function publicIssueCatalogGet(request: NextRequest) {
  const limit = parseLimit(request);
  if (limit === null) {
    return NextResponse.json(
      {
        code: "INVALID_LIMIT",
        message: `limit은 1부터 ${MAXIMUM_LIMIT} 사이의 정수여야 합니다.`,
      },
      { status: 400, headers: responseHeaders("no-store") },
    );
  }

  try {
    const [upstream, completed] = await Promise.all([
      fetchWhichApi(`/v1/issues/catalog?limit=${MAXIMUM_LIMIT}`, {
        headers: { accept: "application/json" },
      }),
      readCompletedIssueIds(),
    ]);
    if (!upstream.ok) throw new Error(`Public Issue catalog returned ${upstream.status}.`);

    const catalog = (await upstream.json()) as { items?: unknown };
    if (!Array.isArray(catalog.items))
      throw new Error("Public Issue catalog returned an invalid payload.");
    const items = catalog.items
      .filter(
        (item): item is { id: string } & Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { id?: unknown }).id === "string" &&
          !completed.has((item as { id: string }).id),
      )
      .slice(0, limit);

    return NextResponse.json(
      { ...catalog, items },
      {
        status: 200,
        headers: responseHeaders("public, max-age=15, s-maxage=15, stale-while-revalidate=30"),
      },
    );
  } catch {
    return NextResponse.json(
      {
        code: "PUBLIC_ISSUES_UNAVAILABLE",
        message: "공개 질문 목록을 불러오지 못했습니다.",
      },
      { status: 502, headers: responseHeaders("no-store") },
    );
  }
}
