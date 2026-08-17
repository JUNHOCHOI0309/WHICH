import * as oidc from "openid-client";
import { NextResponse } from "next/server";

import {
  authBaseUrl,
  encodeOidcFlow,
  googleOidcCredentials,
  OIDC_FLOW_COOKIE,
  sanitizeReturnTo,
  withAuthOutcome,
} from "@/lib/server/member-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const baseUrl = authBaseUrl(request.url);
  const credentials = googleOidcCredentials();

  if (!credentials) {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "unavailable"), baseUrl));
  }

  try {
    const config = await oidc.discovery(
      new URL("https://accounts.google.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = new URL("/api/auth/google/callback", baseUrl).toString();
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid profile",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: OIDC_FLOW_COOKIE,
      value: encodeOidcFlow({ state, nonce, codeVerifier, returnTo, createdAt: Date.now() }),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/google",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "error"), baseUrl));
  }
}
