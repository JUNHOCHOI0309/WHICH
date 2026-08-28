import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  if (params.get("lane")) query.set("lane", params.get("lane")!);
  query.set("limit", params.get("limit") ?? "25");
  return proxyOpsApi(request, `/v1/internal/ops/moderation-queue?${query}`);
}
