import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, GUEST_SUBJECT_COOKIE, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const anonymousSubjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  if (!anonymousSubjectId) {
    return NextResponse.json(
      { code: "VOTE_NOT_FOUND", message: "이 브라우저에 연결된 투표가 없습니다." },
      { status: 404 },
    );
  }

  try {
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}/votes`, {
      headers: {
        accept: "application/json",
        "x-anonymous-subject-id": anonymousSubjectId,
      },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "기존 투표를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
}
