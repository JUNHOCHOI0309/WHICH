import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const subjectId = validGuestSubject(request.headers.get("x-anonymous-subject-id") ?? undefined);
  if (!subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject가 필요합니다." },
      { status: 400 },
    );
  }
  try {
    const upstream = await fetchWhichApi("/v1/interest-profile/reset", {
      method: "POST",
      headers: { accept: "application/json", "x-anonymous-subject-id": subjectId },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "추천 설정을 초기화하지 못했습니다." },
      { status: 502 },
    );
  }
}
