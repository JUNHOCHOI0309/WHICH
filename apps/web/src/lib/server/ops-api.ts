import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CloudflareAccessError, verifyCloudflareAccess } from "./cloudflare-access";
import { internalAuthSecret } from "./member-auth";
import { clearMemberSessionCookie, fetchWhichApi, MEMBER_SESSION_COOKIE } from "./which-api";

export async function authorizeOpsRequest(request: NextRequest) {
  try {
    await verifyCloudflareAccess(request);
  } catch (error) {
    if (error instanceof CloudflareAccessError) {
      return {
        response: NextResponse.json({ code: error.code, message: error.message }, { status: 403 }),
        token: null,
      };
    }
    return {
      response: NextResponse.json(
        { code: "CF_ACCESS_UNAVAILABLE", message: "Cloudflare Access를 확인하지 못했습니다." },
        { status: 502 },
      ),
      token: null,
    };
  }
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return {
      response: NextResponse.json(
        { code: "SESSION_INVALID", message: "WHICH 로그인이 필요합니다." },
        { status: 401 },
      ),
      token: null,
    };
  }
  return { response: null, token };
}

export async function proxyOpsApi(request: NextRequest, path: string, init: RequestInit = {}) {
  const authorization = await authorizeOpsRequest(request);
  if (authorization.response || !authorization.token) return authorization.response!;
  try {
    const upstream = await fetchWhichApi(path, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorization.token}`,
        "x-internal-auth-secret": internalAuthSecret(),
        ...init.headers,
      },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    response.headers.set("cache-control", "private, no-store");
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "OPS_API_UNAVAILABLE", message: "운영 API에 연결하지 못했습니다." },
      { status: 502 },
    );
  }
}
