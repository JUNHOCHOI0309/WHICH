import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  fetchWhichApi,
  interestIdentityForRequest,
  setGuestSubjectCookie,
} from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  try {
    const identity = await interestIdentityForRequest(request);
    const upstream = await fetchWhichApi("/v1/interest-profile/reset", {
      method: "POST",
      headers: { accept: "application/json", ...identity.headers },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (identity.createdGuest && identity.anonymousSubjectId) {
      setGuestSubjectCookie(response, identity.anonymousSubjectId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "INTEREST_PROFILE_UNAVAILABLE", message: "추천 설정을 초기화하지 못했습니다." },
      { status: 502 },
    );
  }
}
