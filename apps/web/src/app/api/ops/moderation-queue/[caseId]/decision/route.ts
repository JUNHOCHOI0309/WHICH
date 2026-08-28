import type { NextRequest } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";

export async function PUT(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  return proxyOpsApi(
    request,
    `/v1/internal/ops/moderation-queue/${encodeURIComponent(caseId)}/decision`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    },
  );
}
