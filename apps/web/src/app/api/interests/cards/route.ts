import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function GET() {
  try {
    const upstream = await fetchWhichApi("/v1/interests/cards", {
      headers: { accept: "application/json" },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "INTERESTS_UNAVAILABLE", message: "관심 주제를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
