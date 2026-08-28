import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  const authorization = request.headers.get("authorization");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!authorization?.startsWith("Bearer ") || !idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "로그인과 요청 식별자가 필요합니다." },
      { status: 401 },
    );
  }

  const { submissionId } = await context.params;
  try {
    const upstream = await fetchWhichApi(
      `/v1/member/issue-submissions/${encodeURIComponent(submissionId)}`,
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: await request.text(),
      },
    );
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      {
        code: "ISSUE_RESUBMISSION_UNAVAILABLE",
        message: "질문 수정본을 잠시 제출하지 못했습니다.",
      },
      { status: 502 },
    );
  }
}
