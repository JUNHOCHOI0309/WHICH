import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function GET(request: NextRequest) {
  return proxyOpsApi(request, "/v1/internal/ops/point-shop");
}

export async function POST(request: NextRequest) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "ORIGIN_MISMATCH", message: "요청 출처가 올바르지 않습니다." },
      { status: 403 },
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
  return proxyOpsApi(request, "/v1/internal/ops/point-shop/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
