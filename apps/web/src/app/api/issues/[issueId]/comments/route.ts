import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  validGuestSubject,
} from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const search = new URLSearchParams();
  for (const name of ["side", "cursor", "limit"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }
  const subjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);

  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/comments?${search.toString()}`,
      {
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        },
      },
    );
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "선택 이유를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "댓글을 게시하려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const { issueId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "멱등성 키가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/comments`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: await request.text(),
    });
    const body: unknown = await upstream.json();
    const response = NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "댓글을 게시하지 못했습니다." },
      { status: 502 },
    );
  }
}
