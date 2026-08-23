import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ issueId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const subjectId = validGuestSubject(request.headers.get("x-anonymous-subject-id") ?? undefined);
  if (!subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/comment-highlights?limitPerSide=5`,
      {
        headers: { accept: "application/json", "x-anonymous-subject-id": subjectId },
      },
    );
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "대표 댓글을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
