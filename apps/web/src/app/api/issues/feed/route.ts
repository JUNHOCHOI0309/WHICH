import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, GUEST_SUBJECT_COOKIE, validGuestSubject } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const search = new URLSearchParams();
  for (const name of ["cursor", "limit", "excludeIssueId"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }

  const subjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);

  try {
    const upstream = await fetchWhichApi(`/v1/issues/feed?${search.toString()}`, {
      headers: {
        accept: "application/json",
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
      },
    });
    const body = (await upstream.json()) as unknown;
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문 목록을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
