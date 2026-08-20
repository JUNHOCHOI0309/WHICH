import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createGuestSubject,
  GUEST_SUBJECT_COOKIE,
  setGuestSubjectCookie,
  validGuestSubject,
} from "@/lib/server/which-api";
import {
  analyticsSessionForRequest,
  setAnalyticsSessionCookie,
} from "@/lib/server/analytics-session";

export async function POST(request: NextRequest) {
  const analyticsSession = analyticsSessionForRequest(request);
  const existingSubject = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  if (existingSubject) {
    const response = NextResponse.json({ status: "ready" }, { status: 200 });
    setAnalyticsSessionCookie(response, analyticsSession);
    return response;
  }

  try {
    const anonymousSubjectId = await createGuestSubject();
    const response = NextResponse.json({ status: "ready" }, { status: 201 });
    setGuestSubjectCookie(response, anonymousSubjectId);
    setAnalyticsSessionCookie(response, analyticsSession);
    return response;
  } catch {
    return NextResponse.json(
      { code: "GUEST_SUBJECT_UNAVAILABLE", message: "참여 준비를 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}
