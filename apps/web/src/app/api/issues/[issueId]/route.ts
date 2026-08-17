import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { issueId } = await context.params;

  try {
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: { accept: "application/json" },
    });
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
