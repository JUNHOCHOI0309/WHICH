import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createResultShareCard } from "@/lib/server/result-sharing";

type RouteContext = { params: Promise<{ issueId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const response = await createResultShareCard(request.url, issueId, {
      issueVersion: body.issueVersion as number,
      resultVersion: body.resultVersion as number,
      channel: body.channel as "COPY" | "SYSTEM" | "X",
      ...(body.sharedChoiceCode === "A" || body.sharedChoiceCode === "B"
        ? { sharedChoiceCode: body.sharedChoiceCode }
        : {}),
    });
    return NextResponse.json(response.body, { status: response.upstream.status });
  } catch {
    return NextResponse.json(
      { code: "SHARING_UNAVAILABLE", message: "공유 링크를 만들지 못했습니다." },
      { status: 502 },
    );
  }
}
