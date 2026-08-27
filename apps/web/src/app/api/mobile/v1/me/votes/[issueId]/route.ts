import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 투표 기록을 확인할 수 있습니다." },
      { status: 401 },
    );
  }

  const { issueId } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/me/votes/${encodeURIComponent(issueId)}`, {
      headers: { accept: "application/json", authorization },
    });
    return NextResponse.json(await upstream.json(), {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "VOTE_LOOKUP_UNAVAILABLE", message: "투표 기록을 확인하지 못했습니다." },
      { status: 502 },
    );
  }
}
