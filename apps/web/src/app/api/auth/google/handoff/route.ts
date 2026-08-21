import { NextResponse } from "next/server";

import {
  authBaseUrl,
  decodeGoogleBrowserHandoff,
  isEmbeddedUserAgent,
} from "@/lib/server/member-auth";
import { googleExternalBrowserPage, startGoogleAuthorization } from "@/lib/server/google-oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const baseUrl = authBaseUrl(request.url);
  const requestUrl = new URL(request.url);
  const ticketValue = requestUrl.searchParams.get("ticket");
  const ticket = decodeGoogleBrowserHandoff(ticketValue);

  if (!ticket || !ticketValue) {
    console.warn(JSON.stringify({ event: "google_auth_failed", stage: "handoff_invalid" }));
    return NextResponse.redirect(new URL("/?auth=error", baseUrl));
  }

  if (isEmbeddedUserAgent(request.headers.get("user-agent"))) {
    return googleExternalBrowserPage(baseUrl, ticketValue);
  }

  return startGoogleAuthorization({
    baseUrl,
    returnTo: ticket.returnTo,
    anonymousSubjectId: ticket.anonymousSubjectId,
  });
}
