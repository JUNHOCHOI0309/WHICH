import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 W Point를 확인할 수 있습니다." },
      { status: 401 },
    );
  }

  const query = new URLSearchParams();
  const limit = request.nextUrl.searchParams.get("limit");
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (limit) query.set("limit", limit);
  if (cursor) query.set("cursor", cursor);

  try {
    const upstream = await fetchWhichApi(`/v1/me/points${query.size ? `?${query}` : ""}`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "POINTS_UNAVAILABLE", message: "W Point를 잠시 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
