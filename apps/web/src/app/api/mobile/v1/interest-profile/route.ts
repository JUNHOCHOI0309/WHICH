import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

async function proxy(request: NextRequest, method: "GET" | "PUT") {
  const providedSubject = request.headers.get("x-anonymous-subject-id");
  const authorization = request.headers.get("authorization");
  const subjectId = validGuestSubject(providedSubject ?? undefined);
  if (providedSubject && !subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!subjectId && !authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "INTEREST_SUBJECT_REQUIRED", message: "관심사 설정 주체가 필요합니다." },
      { status: 400 },
    );
  }
  try {
    const upstream = await fetchWhichApi("/v1/interest-profile", {
      method,
      headers: {
        accept: "application/json",
        ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        ...(authorization ? { authorization } : {}),
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "PUT" ? { body: await request.text() } : {}),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "관심사 설정을 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}

export function GET(request: NextRequest) {
  return proxy(request, "GET");
}

export function PUT(request: NextRequest) {
  return proxy(request, "PUT");
}
