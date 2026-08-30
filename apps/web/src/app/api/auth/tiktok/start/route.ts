import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  encodeAuthFlow,
  randomOAuthValue,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { memberIdForLinkIntent } from "@/lib/server/member-session-bridge";
import {
  buildTikTokAuthorizationUrl,
  tiktokOAuthConfiguration,
  tiktokWebReturnToAllowed,
} from "@/lib/server/tiktok-oauth";
import {
  GUEST_SUBJECT_COOKIE,
  MEMBER_SESSION_COOKIE,
  validGuestSubject,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const configuration = tiktokOAuthConfiguration();
  if (!configuration || !tiktokWebReturnToAllowed(returnTo)) {
    return NextResponse.redirect(
      new URL(withAuthOutcome(returnTo, "unavailable"), authBaseUrl(request.url)),
    );
  }
  try {
    const cookieStore = await cookies();
    const linkMemberId = await memberIdForLinkIntent(
      url,
      cookieStore.get(MEMBER_SESSION_COOKIE)?.value,
    );
    const state = randomOAuthValue();
    const response = NextResponse.redirect(buildTikTokAuthorizationUrl(configuration, state));
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set({
      name: AUTH_FLOW_COOKIE,
      value: encodeAuthFlow({
        provider: "TIKTOK",
        state,
        returnTo,
        anonymousSubjectId:
          validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value) ?? undefined,
        ...(linkMemberId ? { intent: "LINK" as const, linkMemberId } : {}),
        createdAt: Date.now(),
      }),
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: AUTH_FLOW_COOKIE_PATH,
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(
      new URL(withAuthOutcome(returnTo, "error"), configuration.baseUrl),
    );
  }
}
