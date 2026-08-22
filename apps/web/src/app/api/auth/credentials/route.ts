import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { sanitizeReturnTo } from "@/lib/server/member-auth";
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

  const returnTo = sanitizeReturnTo(typeof body.returnTo === "string" ? body.returnTo : "/me");
  const cookieStore = await cookies();
  const anonymousSubjectId = validGuestSubject(cookieStore.get(GUEST_SUBJECT_COOKIE)?.value);

  try {
    const session = await createCredentialMemberSession({
      mode: body.mode,
      email: body.email,
      password: body.password,
      anonymousSubjectId,
    });
    const response = NextResponse.json({ ok: true, returnTo });
    setMemberSessionCookie(response, session.token, session.expiresAt);
    if (anonymousSubjectId) clearGuestSubjectCookie(response);
    return response;
  } catch (error) {
    const code = error instanceof MemberIdentityLinkError ? error.code : "AUTH_FAILED";
    const status =
      code === "CREDENTIAL_ALREADY_EXISTS" ? 409 : code === "CREDENTIAL_INVALID" ? 401 : 400;
    const message =
      status === 409
        ? "이미 등록된 이메일입니다. 로그인해 주세요."
        : status === 401
          ? "이메일 또는 비밀번호를 확인해 주세요."
          : "계정 처리를 완료하지 못했습니다. 입력값을 확인해 주세요.";
    return NextResponse.json({ code, message }, { status });
  }
}
