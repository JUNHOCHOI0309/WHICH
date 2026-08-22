import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  authFlowMatches,
  decodeAuthFlow,
  kakaoLoginEnabled,
  kakaoOidcCredentials,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { createProviderMemberSession } from "@/lib/server/member-session-bridge";
import {
  clearGuestSubjectCookie,
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

  if (
    !flow ||
    flow.provider !== "KAKAO" ||
    !flow.nonce ||
    !authFlowMatches(flow, "KAKAO", requestUrl.searchParams.get("state"))
  ) {
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
    if (!kakaoLoginEnabled()) throw new Error("Kakao login is disabled.");
    const credentials = kakaoOidcCredentials();
    if (!credentials) throw new Error("Kakao OIDC is not configured.");
    const config = await oidc.discovery(
      new URL("https://kauth.kakao.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    const tokens = await oidc.authorizationCodeGrant(config, requestUrl, {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("Kakao OIDC did not return a subject claim.");

    const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
    const session = await createProviderMemberSession({
      provider: "KAKAO",
      providerSubject: claims.sub,
      displayName:
        typeof claims.nickname === "string"
          ? claims.nickname
          : typeof claims.name === "string"
            ? claims.name
            : "카카오 회원",
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
