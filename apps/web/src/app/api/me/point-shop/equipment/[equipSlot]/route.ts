import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";

async function forward(request: NextRequest, equipSlot: string, method: "PUT" | "DELETE") {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const upstream = await fetchWhichApi(
      `/v1/me/point-shop/equipment/${encodeURIComponent(equipSlot)}`,
      {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(method === "PUT" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "PUT" ? { body: JSON.stringify(await request.json()) } : {}),
      },
    );
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "POINT_SHOP_UNAVAILABLE", message: "장착 상태를 변경하지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ equipSlot: string }> },
) {
  return forward(request, (await context.params).equipSlot, "PUT");
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ equipSlot: string }> },
) {
  return forward(request, (await context.params).equipSlot, "DELETE");
}
