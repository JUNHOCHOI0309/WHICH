import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

function memberToken(request: NextRequest) {
  return request.cookies.get(MEMBER_SESSION_COOKIE)?.value ?? null;
}

export async function GET(request: NextRequest) {
  const token = memberToken(request);
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  try {
    const upstream = await fetchWhichApi("/v1/me/notifications", {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "알림을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const token = memberToken(request);
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  try {
    const body = await request.text();
    const upstream = await fetchWhichApi("/v1/me/notifications", {
      method: "PATCH",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "알림 읽음 상태를 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
