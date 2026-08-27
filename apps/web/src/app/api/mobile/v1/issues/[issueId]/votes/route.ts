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
  const providedSubject = request.headers.get("x-anonymous-subject-id");
  const authorization = request.headers.get("authorization");
  const subjectId = validGuestSubject(providedSubject ?? undefined);
  if (providedSubject && !subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!subjectId && !authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "VOTE_SUBJECT_REQUIRED", message: "투표 주체가 필요합니다." },
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
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ issueVersion: body.issueVersion, choiceId: body.choiceId }),
    });
    const responseBody = (await upstream.json()) as VoteResponse | ApiErrorBody;
    const mobileResponseBody =
      authorization?.startsWith("Bearer ") &&
      process.env.FEATURE_POINTS_ENABLED === "true" &&
      upstream.ok &&
      "outcome" in responseBody &&
      responseBody.outcome === "ACCEPTED"
        ? { ...responseBody, pointFeedback: { amount: 10, reasonLabel: "투표 참여" } }
        : responseBody;
    return NextResponse.json(mobileResponseBody, {
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
