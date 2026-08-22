import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, interestIdentityForRequest } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  try {
    const identity = await interestIdentityForRequest(request);
    const upstream = await fetchWhichApi("/v1/interest-profile/merge", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...identity.headers,
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
