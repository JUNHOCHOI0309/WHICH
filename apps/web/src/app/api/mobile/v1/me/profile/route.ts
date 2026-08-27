import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function PATCH(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 프로필을 설정할 수 있습니다." },
      { status: 401 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/me/profile", {
      method: "PATCH",
      headers: { accept: "application/json", authorization, "content-type": "application/json" },
      body: JSON.stringify(await request.json()),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "PROFILE_UPDATE_UNAVAILABLE", message: "프로필을 잠시 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
