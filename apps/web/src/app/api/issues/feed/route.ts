import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  fetchWhichApi,
  interestIdentityForRequest,
  setGuestSubjectCookie,
} from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const search = new URLSearchParams();
  for (const name of ["cursor", "limit", "excludeIssueId"] as const) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) search.set(name, value);
  }

  try {
    const identity = await interestIdentityForRequest(request);
    const upstream = await fetchWhichApi(`/v1/issues/feed?${search.toString()}`, {
      headers: {
        accept: "application/json",
        ...identity.headers,
      },
    });
    const body = (await upstream.json()) as unknown;
    const response = NextResponse.json(body, { status: upstream.status });
    if (identity.createdGuest && identity.anonymousSubjectId) {
      setGuestSubjectCookie(response, identity.anonymousSubjectId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문 목록을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
