import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!authorization?.startsWith("Bearer ") || !idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "로그인과 요청 식별자가 필요합니다." },
      { status: 401 },
    );
  }
  const upstream = await fetchWhichApi("/v1/issues", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: await request.text(),
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
