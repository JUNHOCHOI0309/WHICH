import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function GET(request: NextRequest) {
  const params = new URLSearchParams({ limit: "50" });
  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (query) params.set("query", query.slice(0, 160));
  return proxyOpsApi(request, `/v1/internal/ops/media-upload-pilot?${params}`);
}
