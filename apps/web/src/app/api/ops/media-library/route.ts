import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function GET(request: NextRequest) {
  const params = new URLSearchParams({ limit: "50" });
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const categoryCode = request.nextUrl.searchParams.get("categoryCode")?.trim();
  if (query) params.set("q", query);
  if (categoryCode) params.set("categoryCode", categoryCode);
  return proxyOpsApi(request, "/v1/member/issue-media-library?" + params.toString());
}

export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request))
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  return proxyOpsApi(request, "/v1/internal/ops/media-library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
