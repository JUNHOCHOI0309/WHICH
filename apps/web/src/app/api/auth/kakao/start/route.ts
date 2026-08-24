import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  encodeAuthFlow,
  kakaoLoginEnabled,
  kakaoOidcCredentials,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { memberIdForLinkIntent } from "@/lib/server/member-session-bridge";
import { MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const baseUrl = authBaseUrl(request.url);
  const credentials = kakaoOidcCredentials();

  if (!kakaoLoginEnabled() || !credentials) {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "unavailable"), baseUrl));
  }

  const cookieStore = await cookies();
  let linkMemberId: string | undefined;
  try {
    linkMemberId = await memberIdForLinkIntent(
      requestUrl,
      cookieStore.get(MEMBER_SESSION_COOKIE)?.value,
    );
  } catch {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "error"), baseUrl));
  }

  try {
    const config = await oidc.discovery(
      new URL("https://kauth.kakao.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = new URL("/api/auth/kakao/callback", baseUrl).toString();
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid profile_nickname profile_image",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: AUTH_FLOW_COOKIE,
      value: encodeAuthFlow({
        provider: "KAKAO",
        state,
        nonce,
        codeVerifier,
        returnTo,
        ...(linkMemberId ? { intent: "LINK" as const, linkMemberId } : {}),
        createdAt: Date.now(),
      }),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: AUTH_FLOW_COOKIE_PATH,
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "error"), baseUrl));
  }
}
