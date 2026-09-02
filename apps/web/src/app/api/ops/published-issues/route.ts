import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

const states = new Set(["ACTIVE", "HIDDEN", "CLOSED", "REMOVED"]);

export async function GET(request: NextRequest) {
  const params = new URLSearchParams({ limit: "50" });
  const state = request.nextUrl.searchParams.get("state");
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (state && !states.has(state)) {
    return NextResponse.json(
      { code: "INVALID_STATE", message: "게시 질문 상태가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (query && query.length > 120) {
    return NextResponse.json(
      { code: "QUERY_TOO_LONG", message: "검색어는 120자 이하여야 합니다." },
      { status: 400 },
    );
  }
  if (state) params.set("state", state);
  if (query) params.set("q", query);
  return proxyOpsApi(request, `/v1/internal/ops/published-issues?${params}`);
}
