import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 내 기록을 확인할 수 있습니다." },
      { status: 401 },
    );
  }

  const query = new URLSearchParams();
  const limit = request.nextUrl.searchParams.get("limit");
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (limit) query.set("limit", limit);
  if (cursor) query.set("cursor", cursor);

  try {
    const upstream = await fetchWhichApi(`/v1/me${query.size ? `?${query}` : ""}`, {
      headers: { accept: "application/json", authorization },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "PROFILE_UNAVAILABLE", message: "내 기록을 잠시 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
