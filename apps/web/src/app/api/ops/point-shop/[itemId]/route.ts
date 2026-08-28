import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json(
      { code: "ORIGIN_MISMATCH", message: "요청 출처가 올바르지 않습니다." },
      { status: 403 },
    );
  }
  const { itemId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
    return NextResponse.json(
      { code: "INVALID_ITEM_ID", message: "상품 ID가 올바르지 않습니다." },
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
  return proxyOpsApi(request, `/v1/internal/ops/point-shop/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
