import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { mobileAuthCompletionPath, readMobileAuthRequest } from "@/lib/server/mobile-auth";
import { publicOriginForRequest } from "@/lib/server/request-origin";

export async function GET(request: NextRequest) {
  const authRequest = readMobileAuthRequest(request.nextUrl.searchParams);
  if (!authRequest) {
    return NextResponse.json(
      { code: "MOBILE_AUTH_REQUEST_INVALID", message: "모바일 인증 요청이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  return NextResponse.redirect(
    new URL(mobileAuthCompletionPath(authRequest), publicOriginForRequest(request)),
  );
}
