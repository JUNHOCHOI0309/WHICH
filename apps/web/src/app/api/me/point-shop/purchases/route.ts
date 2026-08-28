import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const upstream = await fetchWhichApi("/v1/me/point-shop/purchases", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(await request.json()),
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "POINT_SHOP_UNAVAILABLE", message: "구매를 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}
