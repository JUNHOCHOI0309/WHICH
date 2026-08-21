import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  decodeAuthFlow,
  googleOidcCredentials,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { createProviderMemberSession } from "@/lib/server/member-session-bridge";
import {
  GUEST_SUBJECT_COOKIE,
  setMemberSessionCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

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

export async function GET(request: Request) {
  const baseUrl = authBaseUrl(request.url);
  const cookieStore = await cookies();
  const flow = decodeAuthFlow(cookieStore.get(AUTH_FLOW_COOKIE)?.value);
  const requestUrl = new URL(request.url);

  if (!flow || flow.provider !== "GOOGLE" || !flow.nonce) {
    console.warn(JSON.stringify({ event: "google_auth_failed", stage: "flow_cookie_invalid" }));
    return NextResponse.redirect(new URL("/?auth=error", baseUrl));
  }

  const failure = requestUrl.searchParams.get("error");
  if (failure) {
    const outcome = failure === "access_denied" ? "cancelled" : "error";
    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, outcome), baseUrl),
    );
    clearFlowCookie(response);
    return response;
  }

  let stage = "provider_discovery";
  try {
    const credentials = googleOidcCredentials();
    if (!credentials) throw new Error("Google OIDC is not configured.");
    const config = await oidc.discovery(
      new URL("https://accounts.google.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    stage = "token_exchange";
    const tokens = await oidc.authorizationCodeGrant(config, requestUrl, {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    stage = "claims_validation";
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("Google OIDC did not return a subject claim.");

    const anonymousSubjectId =
      validGuestSubject(flow.anonymousSubjectId) ??
      validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
    stage = "member_session";
    const session = await createProviderMemberSession({
      provider: "GOOGLE",
      providerSubject: claims.sub,
      displayName: typeof claims.name === "string" ? claims.name : "WHICH 회원",
      anonymousSubjectId,
    });

    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, "success"), baseUrl),
    );
    setMemberSessionCookie(response, session.token, session.expiresAt);
    clearFlowCookie(response);
    return response;
  } catch {
    console.warn(JSON.stringify({ event: "google_auth_failed", stage }));
    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, "error"), baseUrl),
    );
    clearFlowCookie(response);
    return response;
  }
}
