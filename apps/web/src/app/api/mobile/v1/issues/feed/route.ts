import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const search = new URLSearchParams();
  for (const name of ["cursor", "limit", "excludeIssueId"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }

  const providedSubject = request.headers.get("x-anonymous-subject-id");
  const subjectId = validGuestSubject(providedSubject ?? undefined);
  if (providedSubject && !subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi(`/v1/issues/feed?${search.toString()}`, {
      headers: {
        accept: "application/json",
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
      },
    });
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문 목록을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
