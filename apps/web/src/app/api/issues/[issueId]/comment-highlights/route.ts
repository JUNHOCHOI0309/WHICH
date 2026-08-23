import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  validGuestSubject,
} from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ issueId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const subjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;

  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/comment-highlights?limitPerSide=5`,
      {
        headers: {
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        },
      },
    );
    const body: unknown = await upstream.json();
    const response = NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
    if (upstream.status === 401 && token) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "대표 댓글을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
