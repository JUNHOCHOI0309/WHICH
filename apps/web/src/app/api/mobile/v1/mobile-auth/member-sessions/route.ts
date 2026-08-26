import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  try {
    const upstream = await fetchWhichApi("/v1/mobile-auth/member-sessions", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: await request.text(),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "MOBILE_AUTH_UNAVAILABLE", message: "모바일 로그인을 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}
