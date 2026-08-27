import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 관심사를 연결할 수 있습니다." },
      { status: 401 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/interest-profile/merge", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization,
        "content-type": "application/json",
      },
      body: await request.text(),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "INTEREST_MERGE_UNAVAILABLE", message: "Guest 관심사를 합치지 못했습니다." },
      { status: 502 },
    );
  }
}
