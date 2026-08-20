import { NextResponse } from "next/server";

import { readResultShareCard } from "@/lib/server/result-sharing";

type RouteContext = { params: Promise<{ shareCardId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { shareCardId } = await context.params;
  try {
    const upstream = await readResultShareCard(shareCardId);
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "SHARE_CARD_UNAVAILABLE", message: "공유 결과를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
