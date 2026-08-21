import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  authBaseUrl,
  encodeGoogleBrowserHandoff,
  googleOidcCredentials,
  isEmbeddedUserAgent,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { googleExternalBrowserPage, startGoogleAuthorization } from "@/lib/server/google-oauth";
import { GUEST_SUBJECT_COOKIE, validGuestSubject } from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const baseUrl = authBaseUrl(request.url);
  const credentials = googleOidcCredentials();

  if (!credentials) {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "unavailable"), baseUrl));
  }

  const cookieStore = await cookies();
  const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);

  if (isEmbeddedUserAgent(request.headers.get("user-agent"))) {
    try {
      const ticket = encodeGoogleBrowserHandoff({
        returnTo,
        anonymousSubjectId: anonymousSubjectId ?? undefined,
        createdAt: Date.now(),
      });
      return googleExternalBrowserPage(baseUrl, ticket);
    } catch {
      console.warn(JSON.stringify({ event: "google_auth_failed", stage: "handoff_create" }));
      return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "error"), baseUrl));
    }
  }

  return startGoogleAuthorization({
    baseUrl,
    returnTo,
    anonymousSubjectId: anonymousSubjectId ?? undefined,
  });
}
