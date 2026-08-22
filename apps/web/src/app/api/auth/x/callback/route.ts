import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  authFlowMatches,
  decodeAuthFlow,
  withAuthOutcome,
  xOAuthCredentials,
} from "@/lib/server/member-auth";
import { createProviderMemberSession } from "@/lib/server/member-session-bridge";
import {
  clearGuestSubjectCookie,
  GUEST_SUBJECT_COOKIE,
  setMemberSessionCookie,
  validGuestSubject,
} from "@/lib/server/which-api";
import { exchangeXAuthorizationCode, fetchXProfile, xDisplayName } from "@/lib/server/x-oauth";

export const runtime = "nodejs";

function clearFlowCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_FLOW_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: AUTH_FLOW_COOKIE_PATH,
    maxAge: 0,
  });
}

function redirectWithOutcome(
  baseUrl: URL,
  returnTo: string,
  outcome: "success" | "cancelled" | "error",
) {
  const response = NextResponse.redirect(new URL(withAuthOutcome(returnTo, outcome), baseUrl));
  clearFlowCookie(response);
  return response;
}

export async function GET(request: Request) {
  const baseUrl = authBaseUrl(request.url);
  const cookieStore = await cookies();
  const flow = decodeAuthFlow(cookieStore.get(AUTH_FLOW_COOKIE)?.value);
  const requestUrl = new URL(request.url);

  if (!flow || !authFlowMatches(flow, "X", requestUrl.searchParams.get("state"))) {
    const response = NextResponse.redirect(new URL("/?auth=error", baseUrl));
    clearFlowCookie(response);
    return response;
  }

  const failure = requestUrl.searchParams.get("error");
  if (failure) {
    return redirectWithOutcome(
      baseUrl,
      flow.returnTo,
      failure === "access_denied" ? "cancelled" : "error",
    );
  }

  try {
    const credentials = xOAuthCredentials();
    const code = requestUrl.searchParams.get("code");
    if (!credentials || !code) throw new Error("X OAuth callback is incomplete.");
    const redirectUri = new URL("/api/auth/x/callback", baseUrl).toString();
    const accessToken = await exchangeXAuthorizationCode({
      credentials,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri,
    });
    const profile = await fetchXProfile(accessToken);
    const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
    const session = await createProviderMemberSession({
      provider: "X",
      providerSubject: profile.id,
      displayName: xDisplayName(profile),
      anonymousSubjectId,
    });
    const response = redirectWithOutcome(baseUrl, flow.returnTo, "success");
    setMemberSessionCookie(response, session.token, session.expiresAt);
    if (anonymousSubjectId) clearGuestSubjectCookie(response);
    return response;
  } catch {
    return redirectWithOutcome(baseUrl, flow.returnTo, "error");
  }
}
