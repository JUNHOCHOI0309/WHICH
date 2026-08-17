import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

export async function DELETE(request: Request) {
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }
  const token = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
  const response = new NextResponse(null, { status: 204 });
  if (token) {
    await fetchWhichApi("/v1/member-session", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
  }
  clearMemberSessionCookie(response);
  return response;
}
