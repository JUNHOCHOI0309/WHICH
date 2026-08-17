import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiErrorBody, VoteResponse } from "@/lib/contracts";
import {
  createGuestSubject,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  setGuestSubjectCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

type VoteRequestBody = {
  issueVersion?: number;
  choiceId?: string;
  idempotencyKey?: string;
};

async function forwardVote(issueId: string, subjectId: string, body: Required<VoteRequestBody>) {
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
  return { upstream, responseBody };
}

function isCompleteVoteRequest(body: VoteRequestBody): body is Required<VoteRequestBody> {
  return (
    Number.isInteger(body.issueVersion) &&
    typeof body.choiceId === "string" &&
    typeof body.idempotencyKey === "string"
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;

  try {
    const body = (await request.json()) as VoteRequestBody;
    if (!isCompleteVoteRequest(body)) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "투표 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const cookieSubject = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
    let subjectId = cookieSubject ?? (await createGuestSubject());
    let vote = await forwardVote(issueId, subjectId, body);

    if (
      cookieSubject &&
      vote.upstream.status === 404 &&
      "code" in vote.responseBody &&
      vote.responseBody.code === "GUEST_SUBJECT_NOT_FOUND"
    ) {
      subjectId = await createGuestSubject();
      vote = await forwardVote(issueId, subjectId, body);
    }

    const response = NextResponse.json(vote.responseBody, { status: vote.upstream.status });
    if (!cookieSubject || subjectId !== cookieSubject) {
      setGuestSubjectCookie(response, subjectId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "투표를 전송하지 못했습니다." },
      { status: 502 },
    );
  }
}
