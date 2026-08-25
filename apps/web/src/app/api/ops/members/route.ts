import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

const statuses = new Set(["ACTIVE", "LIMITED", "SUSPENDED", "DELETED"]);

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const status = request.nextUrl.searchParams.get("status");
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  if (status && !statuses.has(status)) {
    return NextResponse.json(
      { code: "INVALID_STATUS", message: "회원 상태가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (query && query.length > 80) {
    return NextResponse.json(
      { code: "QUERY_TOO_LONG", message: "검색어는 80자 이하여야 합니다." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json(
      { code: "INVALID_LIMIT", message: "조회 수는 1~50이어야 합니다." },
      { status: 400 },
    );
  }
  if (status) params.set("status", status);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return proxyOpsApi(request, `/v1/internal/ops/members?${params}`);
}
