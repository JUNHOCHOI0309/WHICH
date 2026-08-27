import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { deleteStoredAvatar } from "@/lib/server/avatar-storage";
import { fetchWhichApi } from "@/lib/server/which-api";

function bearerAuthorization(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization : null;
}

export async function GET(request: NextRequest) {
  const authorization = bearerAuthorization(request);
  if (!authorization) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인 후 내 기록을 확인할 수 있습니다." },
      { status: 401 },
    );
  }

  const query = new URLSearchParams();
  const limit = request.nextUrl.searchParams.get("limit");
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (limit) query.set("limit", limit);
  if (cursor) query.set("cursor", cursor);

  try {
    const upstream = await fetchWhichApi(`/v1/me${query.size ? `?${query}` : ""}`, {
      headers: { accept: "application/json", authorization },
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "PROFILE_UNAVAILABLE", message: "내 기록을 잠시 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authorization = bearerAuthorization(request);
  if (!authorization) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  let input: { password?: unknown; confirmation?: unknown };
  try {
    input = (await request.json()) as { password?: unknown; confirmation?: unknown };
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "탈퇴 정보를 확인해 주세요." },
      { status: 400 },
    );
  }
  if (typeof input.password !== "string" || !input.password || input.confirmation !== "DELETE") {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "현재 비밀번호와 확인 문구가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/me", {
      method: "DELETE",
      headers: { accept: "application/json", authorization, "content-type": "application/json" },
      body: JSON.stringify({ password: input.password, confirmation: "DELETE" }),
    });
    const body = await upstream.json();
    if (upstream.ok && typeof body?.deletedAvatarObjectKey === "string") {
      await deleteStoredAvatar(body.deletedAvatarObjectKey).catch(() => undefined);
    }
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "ACCOUNT_DELETE_UNAVAILABLE", message: "회원 탈퇴를 잠시 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}
