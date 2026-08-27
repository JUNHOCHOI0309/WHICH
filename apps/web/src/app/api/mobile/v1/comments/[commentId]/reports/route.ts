import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ commentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const providedSubject = request.headers.get("x-anonymous-subject-id");
  const anonymousSubjectId = validGuestSubject(providedSubject ?? undefined);
  const authorization = request.headers.get("authorization");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (providedSubject && !anonymousSubjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!idempotencyKey || (!anonymousSubjectId && !authorization?.startsWith("Bearer "))) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "신고 주체와 멱등성 키가 필요합니다." },
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
        "idempotency-key": idempotencyKey,
        ...(anonymousSubjectId ? { "x-anonymous-subject-id": anonymousSubjectId } : {}),
        ...(authorization?.startsWith("Bearer ") ? { authorization } : {}),
      },
      body: await request.text(),
    });
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "댓글 신고를 접수하지 못했습니다." },
      { status: 502 },
    );
  }
}
