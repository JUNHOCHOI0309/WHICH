import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

type RouteContext = { params: Promise<{ issueId: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "질문을 추천하려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const { issueId } = await context.params;
  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/recommendation`,
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: await request.text(),
      },
    );
    const body: unknown = await upstream.json();
    const response = NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "추천 상태를 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
