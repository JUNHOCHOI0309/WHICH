import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  authBaseUrl,
  decodeOidcFlow,
  googleOidcCredentials,
  internalAuthSecret,
  OIDC_FLOW_COOKIE,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import {
  fetchWhichApi,
  GUEST_SUBJECT_COOKIE,
  setMemberSessionCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

type SessionResponse = {
  token: string;
  expiresAt: string;
};

function clearFlowCookie(response: NextResponse) {
  response.cookies.set({
    name: OIDC_FLOW_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const baseUrl = authBaseUrl(request.url);
  const cookieStore = await cookies();
  const flow = decodeOidcFlow(cookieStore.get(OIDC_FLOW_COOKIE)?.value);
  const requestUrl = new URL(request.url);

  if (!flow) return NextResponse.redirect(new URL("/?auth=error", baseUrl));

  const failure = requestUrl.searchParams.get("error");
  if (failure) {
    const outcome = failure === "access_denied" ? "cancelled" : "error";
    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, outcome), baseUrl),
    );
    clearFlowCookie(response);
    return response;
  }

  try {
    const credentials = googleOidcCredentials();
    if (!credentials) throw new Error("Google OIDC is not configured.");
    const config = await oidc.discovery(
      new URL("https://accounts.google.com"),
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
    if (!claims?.sub) throw new Error("Google OIDC did not return a subject claim.");

    const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
    const upstream = await fetchWhichApi("/v1/internal/member-sessions", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-internal-auth-secret": internalAuthSecret(),
      },
      body: JSON.stringify({
        provider: "GOOGLE",
        providerSubject: claims.sub,
        displayName: typeof claims.name === "string" ? claims.name : "WHICH 회원",
        ...(anonymousSubjectId ? { anonymousSubjectId } : {}),
      }),
    });
    const session = (await upstream.json()) as Partial<SessionResponse>;
    if (!upstream.ok || !session.token || !session.expiresAt) {
      throw new Error("WHICH Member session creation failed.");
    }

    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, "success"), baseUrl),
    );
    setMemberSessionCookie(response, session.token, session.expiresAt);
    clearFlowCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(
      new URL(withAuthOutcome(flow.returnTo, "error"), baseUrl),
    );
    clearFlowCookie(response);
    return response;
  }
}
