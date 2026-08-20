import { NextResponse } from "next/server";

import { createGuestSubject } from "@/lib/server/which-api";

export async function POST() {
  try {
    return NextResponse.json(
      { anonymousSubjectId: await createGuestSubject() },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { code: "GUEST_SUBJECT_UNAVAILABLE", message: "참여 준비를 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}
