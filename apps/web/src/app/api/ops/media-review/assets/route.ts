import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

const statuses = new Set(["PENDING", "APPROVED", "REJECTED", "HIDDEN", "DELETED"]);

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (status && !statuses.has(status))
    return NextResponse.json({ message: "검수 상태가 올바르지 않습니다." }, { status: 400 });
  const params = new URLSearchParams({ limit: "50" });
  if (status) params.set("status", status);
  if (query) params.set("q", query);
  return proxyOpsApi(request, `/v1/internal/ops/media-review/assets?${params}`);
}

export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request))
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  return proxyOpsApi(request, "/v1/internal/ops/media-assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
