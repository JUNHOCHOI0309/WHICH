import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { authRequestKey, sanitizeReturnTo } from "@/lib/server/member-auth";
import { requestEmailVerification, sendAuthEmail } from "@/lib/server/auth-email";
import { NEW_PASSWORD_POLICY_ERROR, newPasswordPolicyError } from "@/lib/password-policy";
import {
  createCredentialMemberSession,
  MemberIdentityLinkError,
} from "@/lib/server/member-session-bridge";
import {
  clearGuestSubjectCookie,
  GUEST_SUBJECT_COOKIE,
  setMemberSessionCookie,
  validGuestSubject,
} from "@/lib/server/which-api";

export const runtime = "nodejs";

function requestIsSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expected = process.env.AUTH_BASE_URL
    ? new URL(process.env.AUTH_BASE_URL).origin
    : request.nextUrl.origin;
  return (
    (origin === null || origin === "null" || origin === expected) &&
    request.headers.get("x-which-csrf") === "member-auth"
  );
}

export async function POST(request: NextRequest) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청을 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  let body: {
    mode?: unknown;
    email?: unknown;
    password?: unknown;
    termsAccepted?: unknown;
    returnTo?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (
    (body.mode !== "login" && body.mode !== "signup") ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    (body.mode === "signup" && body.termsAccepted !== true)
  ) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (body.mode === "signup" && newPasswordPolicyError(body.password)) {
    return NextResponse.json(
      { code: "PASSWORD_INVALID", message: NEW_PASSWORD_POLICY_ERROR },
      { status: 400 },
    );
  }

  const returnTo = sanitizeReturnTo(typeof body.returnTo === "string" ? body.returnTo : "/me");
  const cookieStore = await cookies();
  const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);
  const requestKey = authRequestKey(request.headers, body.email);

  try {
    const session = await createCredentialMemberSession({
      mode: body.mode,
      email: body.email,
      password: body.password,
      anonymousSubjectId,
      authRequestKey: requestKey,
    });
    let target = returnTo;
    if (body.mode === "signup") {
      let emailSent = false;
      try {
        const delivery = await requestEmailVerification(body.email, requestKey);
        emailSent = delivery ? await sendAuthEmail(delivery, "verification", request.url) : false;
      } catch (error) {
        console.error("[auth-email] signup verification delivery failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
      const verificationTarget = new URL("/verify-email", request.nextUrl.origin);
      verificationTarget.searchParams.set("email", body.email.trim());
      verificationTarget.searchParams.set("sent", emailSent ? "1" : "0");
      verificationTarget.searchParams.set("returnTo", returnTo);
      target = `${verificationTarget.pathname}${verificationTarget.search}`;
    }
    const response = NextResponse.json({ ok: true, returnTo: target });
    setMemberSessionCookie(response, session.token, session.expiresAt);
    if (anonymousSubjectId) clearGuestSubjectCookie(response);
    return response;
  } catch (error) {
    const code = error instanceof MemberIdentityLinkError ? error.code : "AUTH_FAILED";
    const status =
      code === "CREDENTIAL_ALREADY_EXISTS"
        ? 409
        : code === "CREDENTIAL_INVALID"
          ? 401
          : code === "EMAIL_UNVERIFIED"
            ? 403
            : code === "AUTH_RATE_LIMITED"
              ? 429
              : 400;
    const message =
      code === "PASSWORD_INVALID"
        ? NEW_PASSWORD_POLICY_ERROR
        : status === 409
          ? "이미 등록된 이메일입니다. 로그인해 주세요."
          : status === 401
            ? "이메일 또는 비밀번호를 확인해 주세요."
            : code === "EMAIL_UNVERIFIED"
              ? "이메일 확인을 먼저 완료해 주세요. 확인 메일을 다시 받을 수 있습니다."
              : status === 429
                ? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
                : "계정 처리를 완료하지 못했습니다. 입력값을 확인해 주세요.";
    return NextResponse.json({ code, message }, { status });
  }
}
