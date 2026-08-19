import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  calculateS256CodeChallenge,
  encodeAuthFlow,
  randomOAuthValue,
  sanitizeReturnTo,
  withAuthOutcome,
  xOAuthCredentials,
} from "@/lib/server/member-auth";
import { buildXAuthorizationUrl } from "@/lib/server/x-oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const baseUrl = authBaseUrl(request.url);
  const credentials = xOAuthCredentials();

  if (!credentials) {
    return NextResponse.redirect(new URL(withAuthOutcome(returnTo, "unavailable"), baseUrl));
  }

  try {
    const codeVerifier = randomOAuthValue();
    const codeChallenge = calculateS256CodeChallenge(codeVerifier);
    const state = randomOAuthValue();
    const redirectUri = new URL("/api/auth/x/callback", baseUrl).toString();
    const authorizationUrl = buildXAuthorizationUrl({
      clientId: credentials.clientId,
      redirectUri,
      state,
      codeChallenge,
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: AUTH_FLOW_COOKIE,
      value: encodeAuthFlow({
        provider: "X",
        state,
        codeVerifier,
        returnTo,
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
