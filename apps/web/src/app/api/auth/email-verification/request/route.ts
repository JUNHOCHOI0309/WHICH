import { type NextRequest, NextResponse } from "next/server";

import { requestEmailVerification, sendAuthEmail } from "@/lib/server/auth-email";
import { authRequestKey } from "@/lib/server/member-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-which-csrf") !== "member-auth") {
    return NextResponse.json({ message: "요청을 확인할 수 없습니다." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string" || body.email.length > 320) {
    return NextResponse.json({ message: "이메일을 확인해 주세요." }, { status: 400 });
  }
  const requestKey = authRequestKey(request.headers, body.email);
  try {
    const delivery = await requestEmailVerification(body.email, requestKey);
    if (delivery) await sendAuthEmail(delivery, "verification", request.url);
    return NextResponse.json({
      ok: true,
      message: "확인이 필요한 계정이라면 새 이메일을 보냈습니다.",
    });
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error && error.status === 429
        ? 429
        : 503;
    return NextResponse.json(
      {
        message:
          status === 429
            ? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            : "확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status },
    );
  }
}
