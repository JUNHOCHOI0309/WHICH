import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, GUEST_SUBJECT_COOKIE, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;
  const search = new URLSearchParams();
  for (const name of ["side", "cursor", "limit"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }
  const subjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);

  try {
    const upstream = await fetchWhichApi(
      `/v1/issues/${encodeURIComponent(issueId)}/comments?${search.toString()}`,
      {
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        },
      },
    );
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "선택 이유를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
