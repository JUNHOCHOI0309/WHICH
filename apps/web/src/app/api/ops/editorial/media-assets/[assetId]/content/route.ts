import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  return proxyOpsApi(
    request,
    `/v1/internal/ops/media-review/assets/${encodeURIComponent(assetId)}/content`,
    { cache: "no-store" },
  );
}
