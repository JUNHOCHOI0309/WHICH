import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

function authorization(request: NextRequest) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value : null;
}

export async function GET(request: NextRequest) {
  const token = authorization(request);
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 제출 상태를 확인할 수 있습니다." },
      { status: 401 },
    );
  }
  const limit = request.nextUrl.searchParams.get("limit") ?? "10";
  try {
    const upstream = await fetchWhichApi(`/v1/member/issue-submissions?limit=${limit}`, {
      headers: { accept: "application/json", authorization: token },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "ISSUE_SUBMISSIONS_UNAVAILABLE", message: "제출 상태를 잠시 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const token = authorization(request);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!token || !idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "로그인과 요청 식별자가 필요합니다." },
      { status: 401 },
    );
  }
  try {
    const upstream = await fetchWhichApi("/v1/member/issue-submissions", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: token,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: await request.text(),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "ISSUE_SUBMISSION_UNAVAILABLE", message: "질문을 잠시 제출하지 못했습니다." },
      { status: 502 },
    );
  }
}
