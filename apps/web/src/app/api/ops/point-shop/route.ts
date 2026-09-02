import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function GET(request: NextRequest) {
  return proxyOpsApi(request, "/v1/internal/ops/point-shop");
}
