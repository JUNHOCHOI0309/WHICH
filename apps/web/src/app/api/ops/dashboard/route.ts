import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CloudflareAccessError, verifyCloudflareAccess } from "@/lib/server/cloudflare-access";
import { internalAuthSecret } from "@/lib/server/member-auth";
import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

export async function GET(request: NextRequest) {
  try {
    await verifyCloudflareAccess(request);
  } catch (error) {
    if (error instanceof CloudflareAccessError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { code: "CF_ACCESS_UNAVAILABLE", message: "Cloudflare Access를 확인하지 못했습니다." },
      { status: 502 },
    );
  }

  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "WHICH 로그인이 필요합니다." },
      { status: 401 },
    );
  }
  const days = request.nextUrl.searchParams.get("days") ?? "7";
  if (!new Set(["1", "7", "30"]).has(days)) {
    return NextResponse.json(
      { code: "INVALID_WINDOW", message: "조회 기간은 1일, 7일, 30일 중 하나여야 합니다." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi(`/v1/internal/ops/dashboard?days=${days}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-internal-auth-secret": internalAuthSecret(),
      },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    response.headers.set("cache-control", "private, no-store");
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "OPS_API_UNAVAILABLE", message: "운영 스냅샷을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
