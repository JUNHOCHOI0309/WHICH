import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
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
  try {
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: {
        accept: "application/json",
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        ...(authorization ? { authorization } : {}),
      },
    });
    const body: unknown = await upstream.json();
    return NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
