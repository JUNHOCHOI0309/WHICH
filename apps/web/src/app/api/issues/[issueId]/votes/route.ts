import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApiErrorBody, VoteResponse } from "@/lib/contracts";
import {
  clearMemberSessionCookie,
  createGuestSubject,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  setGuestSubjectCookie,
  validGuestSubject,
} from "@/lib/server/which-api";
import {
  analyticsSessionForRequest,
  setAnalyticsSessionCookie,
} from "@/lib/server/analytics-session";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

type VoteRequestBody = {
  issueVersion?: number;
  choiceId?: string;
  idempotencyKey?: string;
};

async function forwardVote(
  issueId: string,
  identity: { subjectId?: string; token?: string },
  analyticsSessionId: string,
  body: Required<VoteRequestBody>,
) {
  const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/votes`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": body.idempotencyKey,
      ...(identity.subjectId ? { "x-anonymous-subject-id": identity.subjectId } : {}),
      ...(identity.token ? { authorization: `Bearer ${identity.token}` } : {}),
      "x-analytics-session-id": analyticsSessionId,
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
    const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
    const analyticsSession = analyticsSessionForRequest(request);
    let subjectId = cookieSubject ?? (token ? undefined : await createGuestSubject());
    let vote = await forwardVote(issueId, { subjectId, token }, analyticsSession.id, body);

    if (
      !token &&
      cookieSubject &&
      vote.upstream.status === 404 &&
      "code" in vote.responseBody &&
      vote.responseBody.code === "GUEST_SUBJECT_NOT_FOUND"
    ) {
      subjectId = await createGuestSubject();
      vote = await forwardVote(issueId, { subjectId }, analyticsSession.id, body);
    }

    const response = NextResponse.json(vote.responseBody, { status: vote.upstream.status });
    if (!token && subjectId && (!cookieSubject || subjectId !== cookieSubject)) {
      setGuestSubjectCookie(response, subjectId);
    }
    if (token && vote.upstream.status === 401) clearMemberSessionCookie(response);
    setAnalyticsSessionCookie(response, analyticsSession);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "투표를 전송하지 못했습니다." },
      { status: 502 },
    );
  }
}
