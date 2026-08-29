import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!token || !idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "로그인과 요청 식별자가 필요합니다." },
      { status: 401 },
    );
  }
  const { submissionId } = await context.params;
  const upstream = await fetchWhichApi(
    `/v1/member/issue-submissions/${encodeURIComponent(submissionId)}`,
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: await request.text(),
    },
  );
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
