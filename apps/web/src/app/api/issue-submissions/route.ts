import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_REQUIRED" }, { status: 401 });
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10;
  const query = new URLSearchParams({ limit: String(limit) });
  const submissionId = request.nextUrl.searchParams.get("submissionId");
  if (submissionId) query.set("submissionId", submissionId);
  const upstream = await fetchWhichApi(`/v1/member/issue-submissions?${query}`, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!token || !idempotencyKey) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "로그인과 요청 식별자가 필요합니다." },
      { status: 401 },
    );
  }
  const upstream = await fetchWhichApi("/v1/member/issue-submissions", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: await request.text(),
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
