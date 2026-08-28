import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }
  try {
    const upstream = await fetchWhichApi("/v1/me/moderation/rights", {
      method: "POST",
      headers: { accept: "application/json", authorization, "content-type": "application/json" },
      body: await request.text(),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "권리 요청을 접수하지 못했습니다." },
      { status: 502 },
    );
  }
}
