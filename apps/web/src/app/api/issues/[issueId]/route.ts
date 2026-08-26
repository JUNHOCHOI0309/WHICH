import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  fetchWhichApi,
  interestIdentityForRequest,
  setGuestSubjectCookie,
} from "@/lib/server/which-api";

type RouteContext = {
  params: Promise<{ issueId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { issueId } = await context.params;

  try {
    const identity = await interestIdentityForRequest(request);
    const upstream = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: { accept: "application/json", ...identity.headers },
    });
    const body: unknown = await upstream.json();
    const response = NextResponse.json(body, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
    if (identity.createdGuest && identity.anonymousSubjectId) {
      setGuestSubjectCookie(response, identity.anonymousSubjectId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "질문을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
