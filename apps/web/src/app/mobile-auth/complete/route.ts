import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  issueMobileAuthExchangeTicket,
  mobileAuthCallbackUrl,
  mobileAuthCompletionPath,
  readMobileAuthRequest,
} from "@/lib/server/mobile-auth";
import { loginHref } from "@/lib/auth";
import { publicOriginForRequest } from "@/lib/server/request-origin";
import { clearMemberSessionCookie, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const authRequest = readMobileAuthRequest(request.nextUrl.searchParams);
  if (!authRequest) {
    return NextResponse.json(
      { code: "MOBILE_AUTH_REQUEST_INVALID", message: "모바일 인증 요청이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const sessionToken = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  const phase = request.nextUrl.searchParams.get("phase") === "callback" ? "callback" : "start";
  const authOutcome = request.nextUrl.searchParams.get("auth");
  const callback = (error: string) =>
    NextResponse.redirect(mobileAuthCallbackUrl(authRequest, { error }));

  if (phase === "start" && authRequest.provider !== "email") {
    const returnTo = mobileAuthCompletionPath(authRequest, "callback");
    return NextResponse.redirect(
      new URL(loginHref(authRequest.provider, returnTo), publicOriginForRequest(request)),
    );
  }

  if (phase === "callback" && authOutcome && authOutcome !== "success") {
    return callback(`provider_${authOutcome}`);
  }

  if (!sessionToken) {
    if (phase === "callback") return callback("member_session_missing");
    const login = new URL("/login", publicOriginForRequest(request));
    login.searchParams.set("returnTo", mobileAuthCompletionPath(authRequest, "callback"));
    return NextResponse.redirect(login);
  }

  try {
    const { upstream, body } = await issueMobileAuthExchangeTicket(sessionToken, authRequest);
    if (upstream.status === 401) {
      const login = new URL("/login", publicOriginForRequest(request));
      login.searchParams.set("returnTo", mobileAuthCompletionPath(authRequest, "callback"));
      const response = NextResponse.redirect(login);
      clearMemberSessionCookie(response);
      return response;
    }
    if (!upstream.ok || !body.ticket) {
      return NextResponse.redirect(
        mobileAuthCallbackUrl(authRequest, { error: body.code ?? "ticket_issue_failed" }),
      );
    }
    return NextResponse.redirect(mobileAuthCallbackUrl(authRequest, { ticket: body.ticket }));
  } catch {
    return NextResponse.redirect(
      mobileAuthCallbackUrl(authRequest, { error: "ticket_issue_unavailable" }),
    );
  }
}
