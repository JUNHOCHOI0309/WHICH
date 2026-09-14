import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

const DEFAULT_LIMIT = 100;
const MAXIMUM_LIMIT = 500;
const publicHeaders = {
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
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

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders("public, max-age=86400"),
  });
}

export async function GET(request: NextRequest) {
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
    const upstream = await fetchWhichApi(`/v1/issues/catalog?limit=${limit}`, {
      headers: { accept: "application/json" },
    });
    if (!upstream.ok) throw new Error(`Public Issue catalog returned ${upstream.status}.`);

    return NextResponse.json(await upstream.json(), {
      status: 200,
      headers: responseHeaders("public, max-age=30, s-maxage=60, stale-while-revalidate=120"),
    });
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
