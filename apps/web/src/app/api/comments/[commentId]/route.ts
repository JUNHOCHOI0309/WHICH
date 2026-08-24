import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

type RouteContext = { params: Promise<{ commentId: string }> };

function rejectUnsafeRequest(request: NextRequest) {
  if (hasSamePublicOrigin(request)) return null;
  return NextResponse.json(
    { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
    { status: 403 },
  );
}

function memberToken(request: NextRequest) {
  return request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
}

async function forwardResponse(upstream: Response) {
  const body: unknown = await upstream.json();
  const response = NextResponse.json(body, {
    status: upstream.status,
    headers: { "cache-control": "no-store" },
  });
  if (upstream.status === 401) clearMemberSessionCookie(response);
  return response;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const rejected = rejectUnsafeRequest(request);
  if (rejected) return rejected;

  const token = memberToken(request);
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "댓글을 수정하려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "수정할 댓글 내용을 확인해 주세요." },
      { status: 400 },
    );
  }

  const { commentId } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return forwardResponse(upstream);
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "댓글을 수정하지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const rejected = rejectUnsafeRequest(request);
  if (rejected) return rejected;

  const token = memberToken(request);
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "댓글을 삭제하려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const { commentId } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    return forwardResponse(upstream);
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "댓글을 삭제하지 못했습니다." },
      { status: 502 },
    );
  }
}
