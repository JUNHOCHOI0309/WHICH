import { type NextRequest, NextResponse } from "next/server";

import { confirmEmailVerification } from "@/lib/server/auth-email";
import { authBaseUrl, authRequestKey } from "@/lib/server/member-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const target = new URL("/verify-email", authBaseUrl(request.url));
  if (!token) {
    target.searchParams.set("status", "invalid");
    return NextResponse.redirect(target);
  }
  try {
    await confirmEmailVerification(token, authRequestKey(request.headers, "verify-token"));
    target.searchParams.set("status", "verified");
  } catch {
    target.searchParams.set("status", "invalid");
  }
  return NextResponse.redirect(target);
}
