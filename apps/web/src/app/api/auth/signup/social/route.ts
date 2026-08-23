import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { requestEmailVerification, sendAuthEmail } from "@/lib/server/auth-email";
import {
  SOCIAL_SIGNUP_COOKIE,
  authRequestKey,
  decodeSocialSignupTicket,
} from "@/lib/server/member-auth";
import { completeSocialSignup, MemberIdentityLinkError } from "@/lib/server/member-session-bridge";
import {
  clearGuestSubjectCookie,
  clearSocialSignupCookie,
  setMemberSessionCookie,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-which-csrf") !== "member-auth") {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청을 확인할 수 없습니다." },
      { status: 403 },
    );
  }
  const ticket = decodeSocialSignupTicket((await cookies()).get(SOCIAL_SIGNUP_COOKIE)?.value);
  if (!ticket) {
    return NextResponse.json(
      { code: "SIGNUP_TICKET_EXPIRED", message: "소셜 인증이 만료됐습니다. 다시 시도해 주세요." },
      { status: 401 },
    );
  }

  let body: { mode?: unknown; email?: unknown; password?: unknown; termsAccepted?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (
    (body.mode !== "new" && body.mode !== "existing") ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    (body.mode === "new" && body.termsAccepted !== true)
  ) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }

  try {
    const requestKey = authRequestKey(request.headers, body.email);
    const session = await completeSocialSignup({
      mode: body.mode,
      social: {
        provider: ticket.provider,
        providerSubject: ticket.providerSubject,
        displayName: ticket.displayName,
        suggestedEmail: ticket.suggestedEmail,
        anonymousSubjectId: ticket.anonymousSubjectId,
      },
      email: body.email,
      password: body.password,
      authRequestKey: requestKey,
    });
    let returnTo = ticket.returnTo;
    if (body.mode === "new") {
      let emailSent = false;
      try {
        const delivery = await requestEmailVerification(body.email, requestKey);
        emailSent = delivery ? await sendAuthEmail(delivery, "verification", request.url) : false;
      } catch (error) {
        console.error("[auth-email] social signup verification delivery failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
      const target = new URL("/verify-email", request.nextUrl.origin);
      target.searchParams.set("email", body.email.trim());
      target.searchParams.set("sent", emailSent ? "1" : "0");
      target.searchParams.set("returnTo", ticket.returnTo);
      returnTo = `${target.pathname}${target.search}`;
    }
    const response = NextResponse.json({ ok: true, returnTo });
    setMemberSessionCookie(response, session.token, session.expiresAt);
    clearSocialSignupCookie(response);
    if (ticket.anonymousSubjectId) clearGuestSubjectCookie(response);
    return response;
  } catch (error) {
    const code = error instanceof MemberIdentityLinkError ? error.code : "SIGNUP_FAILED";
    const status =
      code === "CREDENTIAL_INVALID"
        ? 401
        : code === "CREDENTIAL_ALREADY_EXISTS" || code.includes("LINKED")
          ? 409
          : 400;
    const message =
      code === "CREDENTIAL_INVALID"
        ? "기존 WHICH 계정의 이메일 또는 비밀번호를 확인해 주세요."
        : code === "CREDENTIAL_ALREADY_EXISTS"
          ? "이미 등록된 이메일입니다. 기존 계정에 연결하기를 선택해 주세요."
          : "계정 연결을 완료하지 못했습니다. 다시 시도해 주세요.";
    return NextResponse.json({ code, message }, { status });
  }
}
