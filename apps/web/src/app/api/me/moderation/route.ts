import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  try {
    const upstream = await fetchWhichApi("/v1/me/moderation", {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "Moderation 상태를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
