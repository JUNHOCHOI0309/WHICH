import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization)
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const upstream = await fetchWhichApi("/v1/me/point-shop/purchases", {
      method: "POST",
      headers: { accept: "application/json", authorization, "content-type": "application/json" },
      body: JSON.stringify(await request.json()),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "POINT_SHOP_UNAVAILABLE", message: "구매를 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}
