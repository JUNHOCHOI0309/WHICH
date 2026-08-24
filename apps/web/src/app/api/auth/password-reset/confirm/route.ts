import { type NextRequest, NextResponse } from "next/server";

import { confirmPasswordReset } from "@/lib/server/auth-email";
import { authRequestKey } from "@/lib/server/member-auth";
import { clearMemberSessionCookie } from "@/lib/server/which-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-which-csrf") !== "member-auth") {
    return NextResponse.json({ message: "요청을 확인할 수 없습니다." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    password?: unknown;
  } | null;
  if (!body || typeof body.token !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ message: "입력값을 확인해 주세요." }, { status: 400 });
  }
  try {
    await confirmPasswordReset(
      body.token,
      body.password,
      authRequestKey(request.headers, "reset-token"),
    );
    const response = NextResponse.json({ ok: true });
    clearMemberSessionCookie(response);
    return response;
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error && error.status === 429
        ? 429
        : 400;
    return NextResponse.json(
      {
        message:
          status === 429
            ? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            : "재설정 링크가 만료되었거나 이미 사용되었습니다.",
      },
      { status },
    );
  }
}
