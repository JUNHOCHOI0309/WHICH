import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50)));
  return proxyOpsApi(request, `/v1/internal/ops/ranking-preview?limit=${limit}`);
}
