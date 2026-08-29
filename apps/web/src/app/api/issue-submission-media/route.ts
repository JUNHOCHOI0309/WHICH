import { type NextRequest, NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RIGHTS_ATTESTATION =
  "회원가입 시 동의한 WHICH 이미지 정책에 따라 이 이미지를 게시할 권리가 있음을 확인합니다.";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { code: "SESSION_REQUIRED", message: "이미지를 등록하려면 로그인이 필요합니다." },
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
    const submissionId = form.get("submissionId");
    if (
      !file ||
      typeof file === "string" ||
      !ALLOWED_TYPES.has(file.type) ||
      file.size > MAX_FILE_BYTES ||
      typeof submissionId !== "string" ||
      !submissionId
    ) {
      return NextResponse.json(
        {
          code: "ISSUE_MEDIA_INVALID",
          message: "제출 건과 10MB 이하 JPG, PNG, WebP 파일이 필요합니다.",
        },
        { status: 400 },
      );
    }

    const sessionResponse = await fetchWhichApi("/v1/member/issue-media-upload-sessions", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        submissionId,
        consentVersion: process.env.ISSUE_MEDIA_CONSENT_VERSION ?? "which-media-consent-v1",
      }),
    });
    const sessionPayload = (await sessionResponse.json()) as {
      session?: { id: string; token: string };
      code?: string;
      message?: string;
    };
    if (!sessionResponse.ok || !sessionPayload.session) {
      return NextResponse.json(sessionPayload, { status: sessionResponse.status });
    }

    const upstream = await fetchWhichApi("/v1/member/issue-submission-media", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadSessionId: sessionPayload.session.id,
        uploadSessionToken: sessionPayload.session.token,
        rightsAttestation: RIGHTS_ATTESTATION,
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
