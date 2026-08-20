import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  fetchWhichApi,
  interestIdentityForRequest,
  setGuestSubjectCookie,
} from "@/lib/server/which-api";

async function proxy(request: NextRequest, method: "GET" | "PUT") {
  try {
    const identity = await interestIdentityForRequest(request);
    const upstream = await fetchWhichApi("/v1/interest-profile", {
      method,
      headers: {
        accept: "application/json",
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
        ...identity.headers,
      },
      ...(method === "PUT" ? { body: await request.text() } : {}),
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (identity.createdGuest && identity.anonymousSubjectId) {
      setGuestSubjectCookie(response, identity.anonymousSubjectId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "INTEREST_PROFILE_UNAVAILABLE", message: "관심사 설정을 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}

export function GET(request: NextRequest) {
  return proxy(request, "GET");
}

export function PUT(request: NextRequest) {
  return proxy(request, "PUT");
}
