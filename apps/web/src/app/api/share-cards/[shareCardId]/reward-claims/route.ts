import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

type RouteContext = { params: Promise<{ shareCardId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ claimed: false }, { status: 200 });
  const { shareCardId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();
  const upstream = await fetchWhichApi(
    `/v1/share-cards/${encodeURIComponent(shareCardId)}/reward-claims`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
      },
    },
  );
  const body = await upstream.json();
  return NextResponse.json(body, { status: upstream.status });
}
