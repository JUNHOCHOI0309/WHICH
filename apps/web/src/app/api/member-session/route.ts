import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function GET() {
  const token = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }
  const upstream = await fetchWhichApi("/v1/member-session", {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const body = await upstream.json();
  const response = NextResponse.json(body, { status: upstream.status });
  if (upstream.status === 401) clearMemberSessionCookie(response);
  return response;
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  const csrfHeader = request.headers.get("x-which-csrf");
  let publicOrigin = request.nextUrl.origin;
  if (process.env.AUTH_BASE_URL) {
    try {
      publicOrigin = new URL(process.env.AUTH_BASE_URL).origin;
    } catch {
      // Keep the request origin as a safe fallback when configuration is malformed.
    }
  }
  const originMatches = origin === null || origin === "null" || origin === publicOrigin;
  if (!originMatches || csrfHeader !== "member-session-logout") {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (token) {
    let upstream: Response;
    try {
      upstream = await fetchWhichApi("/v1/member-session", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      return NextResponse.json(
        { code: "SESSION_REVOKE_FAILED", message: "로그아웃하지 못했습니다." },
        { status: 502 },
      );
    }

    if (upstream.status !== 204 && upstream.status !== 401) {
      return NextResponse.json(
        { code: "SESSION_REVOKE_FAILED", message: "로그아웃하지 못했습니다." },
        { status: 502 },
      );
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearMemberSessionCookie(response);
  return response;
}
