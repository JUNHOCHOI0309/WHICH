import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function GET(_request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  try {
    const upstream = await fetchWhichApi(`/v1/profiles/${encodeURIComponent(handle)}`, {
      headers: { accept: "application/json" },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "작성자 프로필을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
