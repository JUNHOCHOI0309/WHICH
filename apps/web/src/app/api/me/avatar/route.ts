import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AvatarStorageError } from "@/lib/server/avatar-storage";
import { removeMemberAvatar, uploadMemberAvatar } from "@/lib/server/member-avatar-bridge";
import { publicOriginForRequest } from "@/lib/server/request-origin";
import { MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png"]);

function requestAllowed(request: NextRequest) {
  const origin = request.headers.get("origin");
  const publicOrigin = publicOriginForRequest(request);
  return (
    (origin === null || origin === "null" || origin === publicOrigin) &&
    request.headers.get("x-which-csrf") === "member-avatar"
  );
}

function storageErrorResponse(error: AvatarStorageError) {
  const status = error.code === "AVATAR_STORAGE_UNAVAILABLE" ? 503 : 400;
  return NextResponse.json({ code: error.code, message: error.message }, { status });
}

export async function PUT(request: NextRequest) {
  if (!requestAllowed(request)) {
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
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { code: "AVATAR_TOO_LARGE", message: "프로필 이미지는 5MB 이하만 사용할 수 있습니다." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("avatar");
    if (
      !file ||
      typeof file === "string" ||
      !ALLOWED_UPLOAD_TYPES.has(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      return NextResponse.json(
        { code: "AVATAR_INVALID", message: "5MB 이하 JPG 또는 PNG 파일을 선택해 주세요." },
        { status: 400 },
      );
    }
    const member = await uploadMemberAvatar(token, Buffer.from(await file.arrayBuffer()));
    if (!member) {
      return NextResponse.json(
        { code: "SESSION_INVALID", message: "로그인 세션이 만료되었습니다." },
        { status: 401 },
      );
    }
    return NextResponse.json({ member: { ...member, avatarSource: "CUSTOM" as const } });
  } catch (error) {
    if (error instanceof AvatarStorageError) return storageErrorResponse(error);
    return NextResponse.json(
      { code: "AVATAR_UPLOAD_FAILED", message: "프로필 이미지를 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!requestAllowed(request)) {
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
  try {
    const member = await removeMemberAvatar(token);
    if (!member) {
      return NextResponse.json(
        { code: "SESSION_INVALID", message: "로그인 세션이 만료되었습니다." },
        { status: 401 },
      );
    }
    return NextResponse.json({ member: { ...member, avatarSource: "INITIALS" as const } });
  } catch {
    return NextResponse.json(
      { code: "AVATAR_DELETE_FAILED", message: "프로필 이미지를 삭제하지 못했습니다." },
      { status: 502 },
    );
  }
}
