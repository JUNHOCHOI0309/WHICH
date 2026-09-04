import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

type Context = { params: Promise<{ candidateId: string; choiceCode: string }> };

async function target(context: Context) {
  const { candidateId, choiceCode } = await context.params;
  if (!/^[A-D]$/.test(choiceCode) || candidateId.length < 1 || candidateId.length > 32) return null;
  return `/v1/internal/ops/editorial/${encodeURIComponent(candidateId)}/choices/${choiceCode}/media`;
}

export async function PUT(request: NextRequest, context: Context) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  }
  const path = await target(context);
  if (!path) return NextResponse.json({ message: "선택지가 올바르지 않습니다." }, { status: 400 });
  return proxyOpsApi(request, path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!hasSamePublicOrigin(request)) {
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  }
  const path = await target(context);
  if (!path) return NextResponse.json({ message: "선택지가 올바르지 않습니다." }, { status: 400 });
  return proxyOpsApi(request, path, { method: "DELETE" });
}
