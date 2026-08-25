import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  fetchWhichApi,
  MEMBER_SESSION_COOKIE,
} from "@/lib/server/which-api";
import { publicOriginForRequest } from "@/lib/server/request-origin";
import { deleteStoredAvatar } from "@/lib/server/avatar-storage";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
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
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    if (upstream.status === 401) clearMemberSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "내 기록을 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  const csrfHeader = request.headers.get("x-which-csrf");
  const publicOrigin = publicOriginForRequest(request);
  const originMatches = origin === null || origin === "null" || origin === publicOrigin;
  if (!originMatches || csrfHeader !== "member-account-delete") {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "요청 출처를 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
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
  if (
    typeof input.password !== "string" ||
    input.password.length === 0 ||
    input.confirmation !== "탈퇴합니다"
  ) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "비밀번호와 확인 문구를 정확히 입력해 주세요." },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetchWhichApi("/v1/me", {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: input.password, confirmation: "DELETE" }),
    });
    const body = await upstream.json();
    const response = NextResponse.json(body, { status: upstream.status });
    if (upstream.ok && body?.deleted === true) {
      clearMemberSessionCookie(response);
      if (typeof body.deletedAvatarObjectKey === "string") {
        await deleteStoredAvatar(body.deletedAvatarObjectKey).catch(() => undefined);
      }
    }
    return response;
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "회원 탈퇴를 처리하지 못했습니다." },
      { status: 502 },
    );
  }
}
