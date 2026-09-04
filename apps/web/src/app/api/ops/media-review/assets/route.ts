import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

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
