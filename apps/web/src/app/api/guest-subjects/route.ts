import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createGuestSubject,
  GUEST_SUBJECT_COOKIE,
  setGuestSubjectCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const existingSubject = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  if (existingSubject) {
    return NextResponse.json({ status: "ready" }, { status: 200 });
  }

  try {
    const anonymousSubjectId = await createGuestSubject();
    const response = NextResponse.json({ status: "ready" }, { status: 201 });
    setGuestSubjectCookie(response, anonymousSubjectId);
    return response;
  } catch {
    return NextResponse.json(
      { code: "GUEST_SUBJECT_UNAVAILABLE", message: "참여 준비를 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}
