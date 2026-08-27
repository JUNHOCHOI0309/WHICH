import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ issueId: string }> };

function mobileIdentity(request: NextRequest) {
  const providedSubject = request.headers.get("x-anonymous-subject-id");
  const anonymousSubjectId = validGuestSubject(providedSubject ?? undefined);
  const authorization = request.headers.get("authorization");
  return {
    anonymousSubjectId,
    authorization: authorization?.startsWith("Bearer ") ? authorization : null,
    invalidSubject: Boolean(providedSubject && !anonymousSubjectId),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const identity = mobileIdentity(request);
  if (identity.invalidSubject) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { issueId } = await context.params;
  const search = new URLSearchParams();
  for (const name of ["side", "cursor", "limit"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }

  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/comments?${search.toString()}`,
      {
        headers: {
          accept: "application/json",
          ...(identity.anonymousSubjectId
            ? { "x-anonymous-subject-id": identity.anonymousSubjectId }
            : {}),
          ...(identity.authorization ? { authorization: identity.authorization } : {}),
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
  const identity = mobileIdentity(request);
  if (identity.invalidSubject) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!identity.authorization) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "댓글을 게시하려면 로그인이 필요합니다." },
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

  const { issueId } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/comments`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: identity.authorization,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...(identity.anonymousSubjectId
          ? { "x-anonymous-subject-id": identity.anonymousSubjectId }
          : {}),
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
      { code: "API_UNAVAILABLE", message: "댓글을 게시하지 못했습니다." },
      { status: 502 },
    );
  }
}
