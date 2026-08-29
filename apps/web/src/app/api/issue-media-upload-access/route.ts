import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "로그인 후 이미지 업로드 권한을 확인할 수 있어요." },
      { status: 401 },
    );
  }
  const upstream = await fetchWhichApi("/v1/member/issue-media-upload-access", {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
