import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ shareCardId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ claimed: false }, { status: 200 });
  }
  const { shareCardId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();

  try {
    const upstream = await fetchWhichApi(
      `/v1/share-cards/${encodeURIComponent(shareCardId)}/reward-claims`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization,
          "idempotency-key": idempotencyKey,
        },
      },
    );
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "공유 포인트를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
}
