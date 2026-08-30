import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  authFlowMatches,
  decodeAuthFlow,
  encodeSocialSignupTicket,
  type AuthOutcome,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import {
  createOAuthMemberSession,
  memberIdForLinkIntent,
  oauthFailureOutcome,
} from "@/lib/server/member-session-bridge";
import {
  authenticateTikTokCode,
  tiktokOAuthConfiguration,
  tiktokWebReturnToAllowed,
} from "@/lib/server/tiktok-oauth";
import {
  clearGuestSubjectCookie,
  MEMBER_SESSION_COOKIE,
  setMemberSessionCookie,
  setSocialSignupCookie,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

function clearFlow(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set({
    name: AUTH_FLOW_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: AUTH_FLOW_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const configuration = tiktokOAuthConfiguration();
  const baseUrl = configuration?.baseUrl ?? authBaseUrl(request.url);
  const fail = (returnTo: string, outcome: AuthOutcome) =>
    clearFlow(NextResponse.redirect(new URL(withAuthOutcome(returnTo, outcome), baseUrl)));
  const cookieStore = await cookies();
  const flow = decodeAuthFlow(cookieStore.get(AUTH_FLOW_COOKIE)?.value);
  if (
    !flow ||
    url.searchParams.getAll("state").length !== 1 ||
    !authFlowMatches(flow, "TIKTOK", url.searchParams.get("state"))
  ) {
    return fail("/", "error");
  }
  if (!configuration || !tiktokWebReturnToAllowed(flow.returnTo))
    return fail(flow.returnTo, "unavailable");
  if (url.searchParams.getAll("error").length > 1 || url.searchParams.getAll("code").length > 1)
    return fail(flow.returnTo, "error");
  const error = url.searchParams.get("error");
  if (error) return fail(flow.returnTo, error === "access_denied" ? "cancelled" : "error");
  try {
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) throw new Error("TikTok callback is incomplete.");
    if (flow.intent === "LINK") {
      const linkUrl = new URL(request.url);
      linkUrl.searchParams.set("intent", "link");
      if (
        (await memberIdForLinkIntent(linkUrl, cookieStore.get(MEMBER_SESSION_COOKIE)?.value)) !==
        flow.linkMemberId
      ) {
        throw new Error("The Member session changed during linking.");
      }
    }
    const profile = await authenticateTikTokCode(configuration, code);
    const session = await createOAuthMemberSession(flow, {
      provider: "TIKTOK",
      ...profile,
      anonymousSubjectId: flow.anonymousSubjectId,
    });
    if (session.kind === "signup") {
      const response = clearFlow(NextResponse.redirect(new URL("/signup/social", baseUrl)));
      setSocialSignupCookie(
        response,
        encodeSocialSignupTicket({
          provider: "TIKTOK",
          ...profile,
          anonymousSubjectId: flow.anonymousSubjectId,
          returnTo: flow.returnTo,
          createdAt: Date.now(),
        }),
      );
      return response;
    }
    const response = fail(flow.returnTo, "success");
    setMemberSessionCookie(response, session.token, session.expiresAt);
    if (flow.anonymousSubjectId) clearGuestSubjectCookie(response);
    return response;
  } catch (error) {
    return fail(flow.returnTo, oauthFailureOutcome(error));
  }
}
