import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> },
) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "ORIGIN_MISMATCH", message: "요청 출처가 올바르지 않습니다." },
      { status: 403 },
    );
  }
  const { issueId } = await context.params;
  if (!uuid.test(issueId)) {
    return NextResponse.json(
      { code: "INVALID_ISSUE", message: "질문 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON", message: "요청 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  return proxyOpsApi(request, `/v1/internal/ops/published-issues/${encodeURIComponent(issueId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
