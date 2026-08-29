import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "이미지 Library는 로그인 후 이용할 수 있어요." },
      { status: 401 },
    );
  }
  const upstream = await fetchWhichApi(
    "/v1/member/issue-media-library?" + request.nextUrl.searchParams.toString(),
    { headers: { accept: "application/json", authorization } },
  );
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
