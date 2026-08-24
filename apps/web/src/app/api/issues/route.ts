import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "질문을 만들려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { code: "IDEMPOTENCY_KEY_REQUIRED", message: "요청 키가 필요합니다." },
      { status: 400 },
    );
  }

  const upstream = await fetchWhichApi("/v1/issues", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
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
