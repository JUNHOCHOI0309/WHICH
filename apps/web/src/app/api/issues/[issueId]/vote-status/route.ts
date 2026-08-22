import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  validGuestSubject,
} from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const memberToken = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  const anonymousSubjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);

  try {
    let invalidMemberSession = false;
    if (memberToken) {
      const memberVote = await fetchWhichApi(`/v1/me/votes/${encodeURIComponent(issueId)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${memberToken}` },
      });
      const body = await memberVote.json();
      if (memberVote.status === 200) return NextResponse.json(body);
      if (memberVote.status !== 401 && memberVote.status !== 404) {
        return NextResponse.json(body, { status: memberVote.status });
      }
      invalidMemberSession = memberVote.status === 401;
    }

    if (!anonymousSubjectId) {
      const response = NextResponse.json(
        { code: "VOTE_NOT_FOUND", message: "이 계정에 연결된 투표가 없습니다." },
        { status: 404 },
      );
      if (invalidMemberSession) clearMemberSessionCookie(response);
      return response;
    }

    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/votes`, {
      headers: {
        accept: "application/json",
        "x-anonymous-subject-id": anonymousSubjectId,
      },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (invalidMemberSession) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "기존 투표를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
}
