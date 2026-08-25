import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { NEW_PASSWORD_POLICY_ERROR, newPasswordPolicyError } from "@/lib/password-policy";
import { requestEmailVerification, sendAuthEmail } from "@/lib/server/auth-email";
import { authRequestKey, internalAuthSecret } from "@/lib/server/member-auth";
import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-which-csrf") !== "member-auth") {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청을 확인할 수 없습니다." },
      { status: 403 },
    );
  }
  const token = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }
  const sessionResponse = await fetchWhichApi("/v1/member-session", {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const session = (await sessionResponse.json()) as { member?: { id?: string } };
  if (!sessionResponse.ok || !session.member?.id) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "입력값을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (newPasswordPolicyError(body.password)) {
    return NextResponse.json(
      { code: "PASSWORD_INVALID", message: NEW_PASSWORD_POLICY_ERROR },
      { status: 400 },
    );
  }

  const upstream = await fetchWhichApi("/v1/internal/member-credentials", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify({
      memberId: session.member.id,
      email: body.email,
      password: body.password,
    }),
  });
  const result = (await upstream.json()) as { code?: string; message?: string };
  if (!upstream.ok) {
    return NextResponse.json(
      {
        code: result.code ?? "CREDENTIAL_SETUP_FAILED",
        message:
          result.code === "PASSWORD_INVALID"
            ? NEW_PASSWORD_POLICY_ERROR
            : result.code === "CREDENTIAL_ALREADY_EXISTS"
              ? "이미 사용 중인 이메일이거나 계정 로그인이 설정되어 있습니다."
              : "이메일 로그인을 설정하지 못했습니다. 입력값을 확인해 주세요.",
      },
      { status: upstream.status },
    );
  }
  const requestKey = authRequestKey(request.headers, body.email);
  let emailSent = false;
  try {
    const delivery = await requestEmailVerification(body.email, requestKey);
    emailSent = delivery ? await sendAuthEmail(delivery, "verification", request.url) : false;
  } catch (error) {
    console.error("[auth-email] credential completion verification delivery failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  const target = new URL("/verify-email", request.nextUrl.origin);
  target.searchParams.set("email", body.email.trim());
  target.searchParams.set("sent", emailSent ? "1" : "0");
  target.searchParams.set("returnTo", "/me");
  return NextResponse.json({
    ok: true,
    verificationRequired: true,
    emailSent,
    returnTo: `${target.pathname}${target.search}`,
  });
}
