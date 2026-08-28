import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi } from "@/lib/server/which-api";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json(
      { code: "SESSION_INVALID", message: "이미지를 등록하려면 로그인이 필요합니다." },
      { status: 401 },
    );
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { code: "MEDIA_TOO_LARGE", message: "선택지 이미지는 10MB 이하만 사용할 수 있습니다." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("media");
    const rightsAttestation = form.get("rightsAttestation");
    if (
      !file ||
      typeof file === "string" ||
      !ALLOWED_TYPES.has(file.type) ||
      file.size > MAX_FILE_BYTES ||
      typeof rightsAttestation !== "string" ||
      rightsAttestation.trim().length < 20
    ) {
      return NextResponse.json(
        {
          code: "ISSUE_MEDIA_INVALID",
          message: "10MB 이하 JPG, PNG, WebP 파일과 이미지 권리 확인이 필요합니다.",
        },
        { status: 400 },
      );
    }
    const upstream = await fetchWhichApi("/v1/member/issue-submission-media", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rightsAttestation: rightsAttestation.trim(),
        declaredMimeType: file.type,
        contentBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      }),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "ISSUE_MEDIA_UNAVAILABLE", message: "이미지를 잠시 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
