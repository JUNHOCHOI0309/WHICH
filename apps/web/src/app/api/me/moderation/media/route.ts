import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("media");
    const rightsAttestation = form.get("rightsAttestation");
    if (
      !file ||
      typeof file === "string" ||
      !ALLOWED_TYPES.has(file.type) ||
      file.size > 10 * 1024 * 1024 ||
      typeof rightsAttestation !== "string" ||
      rightsAttestation.trim().length < 20
    ) {
      return NextResponse.json(
        { code: "ISSUE_MEDIA_INVALID", message: "이미지와 20자 이상의 권리 확인을 입력해 주세요." },
        { status: 400 },
      );
    }
    const upstream = await fetchWhichApi("/v1/member/issue-submission-media", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
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
      { code: "ISSUE_MEDIA_UNAVAILABLE", message: "이미지를 저장하지 못했습니다." },
      { status: 502 },
    );
  }
}
