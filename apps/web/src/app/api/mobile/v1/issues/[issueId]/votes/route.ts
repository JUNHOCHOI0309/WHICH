import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiErrorBody, VoteResponse } from "@/lib/contracts";
import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

type VoteRequestBody = {
  issueVersion?: number;
  choiceId?: string;
  idempotencyKey?: string;
};

function completeVoteRequest(body: VoteRequestBody): body is Required<VoteRequestBody> {
  return (
    Number.isInteger(body.issueVersion) &&
    typeof body.choiceId === "string" &&
    typeof body.idempotencyKey === "string"
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const subjectId = validGuestSubject(request.headers.get("x-anonymous-subject-id") ?? undefined);
  if (!subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as VoteRequestBody;
    if (!completeVoteRequest(body)) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "투표 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/votes`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": body.idempotencyKey,
        "x-anonymous-subject-id": subjectId,
      },
      body: JSON.stringify({ issueVersion: body.issueVersion, choiceId: body.choiceId }),
    });
    const responseBody = (await upstream.json()) as VoteResponse | ApiErrorBody;
    return NextResponse.json(responseBody, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "투표를 전송하지 못했습니다." },
      { status: 502 },
    );
  }
}
