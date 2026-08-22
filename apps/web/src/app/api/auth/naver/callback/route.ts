import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  authBaseUrl,
  authFlowMatches,
  decodeAuthFlow,
  naverLoginEnabled,
  naverOidcCredentials,
  withAuthOutcome,
} from "@/lib/server/member-auth";
import { createProviderMemberSession } from "@/lib/server/member-session-bridge";
import {
  GUEST_SUBJECT_COOKIE,
  setMemberSessionCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

type NaverAuthFailureStage =
  | "flow_validation"
  | "provider_response"
  | "feature_flag"
  | "credentials"
  | "discovery"
  | "token_exchange"
  | "claims"
  | "member_session";

function logNaverAuthFailure(stage: NaverAuthFailureStage, error?: unknown) {
  const safeErrorValue = (key: "code" | "error") => {
    if (!error || typeof error !== "object" || !(key in error)) return undefined;
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : undefined;
  };
  const errorCode = safeErrorValue("code");
  const providerError = safeErrorValue("error");
  const providerStatus =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : undefined;
  console.warn(
    JSON.stringify({
      event: "naver_auth_failed",
      stage,
      ...(error instanceof Error ? { errorName: error.name } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(providerError ? { providerError } : {}),
      ...(providerStatus ? { providerStatus } : {}),
    }),
  );
}

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
  const tokenCallbackUrl = new URL("/api/auth/naver/callback", baseUrl);
  tokenCallbackUrl.search = requestUrl.search;

  if (
    !flow ||
    flow.provider !== "NAVER" ||
    !authFlowMatches(flow, "NAVER", requestUrl.searchParams.get("state"))
  ) {
    logNaverAuthFailure("flow_validation");
    const response = NextResponse.redirect(new URL("/?auth=error", baseUrl));
    clearFlowCookie(response);
    return response;
  }

  const failure = requestUrl.searchParams.get("error");
  if (failure) {
    logNaverAuthFailure("provider_response");
    return redirectWithOutcome(
      baseUrl,
      flow.returnTo,
      failure === "access_denied" ? "cancelled" : "error",
    );
  }

  let stage: NaverAuthFailureStage = "feature_flag";
  try {
    if (!naverLoginEnabled()) throw new Error("Naver login is disabled.");
    stage = "credentials";
    const credentials = naverOidcCredentials();
    if (!credentials) throw new Error("Naver OIDC is not configured.");
    stage = "discovery";
    const config = await oidc.discovery(
      new URL("https://nid.naver.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    stage = "token_exchange";
    const tokens = await oidc.authorizationCodeGrant(
      config,
      tokenCallbackUrl,
      {
        pkceCodeVerifier: flow.codeVerifier,
        expectedState: flow.state,
        idTokenExpected: true,
      },
      { state: flow.state },
    );
    stage = "claims";
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("Naver OIDC did not return a subject claim.");

    const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
    stage = "member_session";
    const session = await createProviderMemberSession({
      provider: "NAVER",
      providerSubject: claims.sub,
      displayName: typeof claims.name === "string" ? claims.name : "네이버 회원",
      anonymousSubjectId,
    });

    const response = redirectWithOutcome(baseUrl, flow.returnTo, "success");
    setMemberSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    logNaverAuthFailure(stage, error);
    return redirectWithOutcome(baseUrl, flow.returnTo, "error");
  }
}
