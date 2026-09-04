import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

const statuses = new Set(["PENDING", "APPROVED", "NEEDS_CHANGES", "REJECTED"]);
const scopes = new Set(["ACTIVE", "RESERVE", "LONG_TERM"]);

export async function GET(request: NextRequest) {
  const params = new URLSearchParams();
  const status = request.nextUrl.searchParams.get("status");
  const scope = request.nextUrl.searchParams.get("scope");
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  if (status && !statuses.has(status)) {
    return NextResponse.json(
      { code: "INVALID_STATUS", message: "심사 상태가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (scope && !scopes.has(scope)) {
    return NextResponse.json(
      { code: "INVALID_SCOPE", message: "재고 범위가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (query && query.length > 120) {
    return NextResponse.json(
      { code: "QUERY_TOO_LONG", message: "검색어는 120자 이하여야 합니다." },
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
  if (scope) params.set("scope", scope);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return proxyOpsApi(request, `/v1/internal/ops/editorial?${params}`);
}

export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  }
  return proxyOpsApi(request, "/v1/internal/ops/editorial", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
