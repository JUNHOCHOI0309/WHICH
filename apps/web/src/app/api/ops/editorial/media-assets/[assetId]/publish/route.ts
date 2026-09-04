import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  }
  const { assetId } = await context.params;
  return proxyOpsApi(
    request,
    `/v1/internal/ops/media-assets/${encodeURIComponent(assetId)}/publish`,
    { method: "POST" },
  );
}
