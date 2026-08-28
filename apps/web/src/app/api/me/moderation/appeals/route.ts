import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  try {
    const upstream = await fetchWhichApi("/v1/me/moderation/appeals", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(await request.json()),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "재검토 요청을 접수하지 못했습니다." },
      { status: 502 },
    );
  }
}
