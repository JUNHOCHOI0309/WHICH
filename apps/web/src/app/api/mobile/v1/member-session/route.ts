import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

function authorization(request: NextRequest) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value : null;
}

function unauthorized() {
  return NextResponse.json(
    { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
    { status: 401 },
  );
}

async function proxy(request: NextRequest, method: "GET" | "POST" | "DELETE") {
  const token = authorization(request);
  if (!token) return unauthorized();
  const path = method === "POST" ? "/v1/member-session/refresh" : "/v1/member-session";
  try {
    const upstream = await fetchWhichApi(path, {
      method,
      headers: { accept: "application/json", authorization: token },
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "SESSION_UNAVAILABLE", message: "세션 요청을 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}

export const GET = (request: NextRequest) => proxy(request, "GET");
export const POST = (request: NextRequest) => proxy(request, "POST");
export const DELETE = (request: NextRequest) => proxy(request, "DELETE");
