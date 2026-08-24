import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  validGuestSubject,
} from "@/lib/server/which-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

type RouteContext = { params: Promise<{ commentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  const subjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  if (!token && !subjectId) {
    return NextResponse.json(
      { code: "REPORT_SUBJECT_REQUIRED", message: "투표 참여 정보가 필요합니다." },
      { status: 401 },
    );
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "멱등성 키가 필요합니다." },
      { status: 400 },
    );
  }

  const { commentId } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/comments/${encodeURIComponent(commentId)}/reports`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        "idempotency-key": idempotencyKey,
      },
      body: await request.text(),
    });
    const body: unknown = await upstream.json();
    const response = NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
    if (upstream.status === 401 && token) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "댓글 신고를 접수하지 못했습니다." },
      { status: 502 },
    );
  }
}
