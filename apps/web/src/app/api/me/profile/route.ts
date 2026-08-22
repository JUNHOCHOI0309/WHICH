import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 공개 프로필을 설정할 수 있습니다." },
      { status: 401 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/me/profile", {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(await request.json()),
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "공개 프로필을 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
