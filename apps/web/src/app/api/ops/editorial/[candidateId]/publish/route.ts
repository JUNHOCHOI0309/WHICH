import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ candidateId: string }> },
) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "ORIGIN_MISMATCH", message: "요청 출처가 올바르지 않습니다." },
      { status: 403 },
    );
  }
  const { candidateId } = await context.params;
  if (!candidateId || candidateId.length > 32) {
    return NextResponse.json(
      { code: "INVALID_CANDIDATE", message: "후보 ID가 올바르지 않습니다." },
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
  return proxyOpsApi(
    request,
    `/v1/internal/ops/editorial/${encodeURIComponent(candidateId)}/publish`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
}
