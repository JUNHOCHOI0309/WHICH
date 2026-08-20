import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

async function proxy(request: NextRequest, method: "GET" | "PUT") {
  const subjectId = validGuestSubject(request.headers.get("x-anonymous-subject-id") ?? undefined);
  if (!subjectId) {
    return NextResponse.json(
      { code: "INVALID_GUEST_SUBJECT", message: "Guest Subject가 필요합니다." },
      { status: 400 },
    );
  }
  try {
    const upstream = await fetchWhichApi("/v1/interest-profile", {
      method,
      headers: {
        accept: "application/json",
        "x-anonymous-subject-id": subjectId,
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
