import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "이미지 Library는 로그인 후 이용할 수 있어요." },
      { status: 401 },
    );
  }
  const search = new URLSearchParams();
  for (const key of ["q", "categoryCode", "limit"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) search.set(key, value);
  }
  const upstream = await fetchWhichApi(`/v1/member/issue-media-library?${search}`, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
