import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AvatarStorageError } from "@/lib/server/avatar-storage";
import { removeMemberAvatar, uploadMemberAvatar } from "@/lib/server/member-avatar-bridge";

const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png"]);

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
}

function errorResponse(error: AvatarStorageError) {
  const status = error.code === "AVATAR_STORAGE_UNAVAILABLE" ? 503 : 400;
  return NextResponse.json({ code: error.code, message: error.message }, { status });
}

export async function PUT(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "로그인이 필요합니다." },
      { status: 401 },
    );
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
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
        { code: "SESSION_INVALID", message: "세션이 만료되었습니다." },
        { status: 401 },
      );
    }
    return NextResponse.json({ member: { ...member, avatarSource: "CUSTOM" as const } });
  } catch (error) {
    if (error instanceof AvatarStorageError) return errorResponse(error);
    return NextResponse.json(
      { code: "AVATAR_UPLOAD_FAILED", message: "프로필 이미지를 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const token = bearerToken(request);
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
        { code: "SESSION_INVALID", message: "세션이 만료되었습니다." },
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
