import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function GET(request: NextRequest) {
  return proxyOpsApi(request, "/v1/internal/ops/media-review/rights-requests?limit=100");
}
export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request))
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  return proxyOpsApi(request, "/v1/internal/ops/media-review/rights-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
