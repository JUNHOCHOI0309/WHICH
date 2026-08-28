import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const upstream = await fetchWhichApi("/v1/me/point-shop", {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "POINT_SHOP_UNAVAILABLE", message: "상점을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
