import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  return proxyOpsApi(
    request,
    `/v1/internal/ops/moderation-queue/${encodeURIComponent(caseId)}/views`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    },
  );
}
