import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_INVALID" }, { status: 401 });
  const { submissionId } = await context.params;
  try {
    const upstream = await fetchWhichApi(
      `/v1/me/moderation/submissions/${encodeURIComponent(submissionId)}/asset-alternative`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(await request.json()),
      },
    );
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "API_UNAVAILABLE", message: "이미지 대안을 적용하지 못했습니다." },
      { status: 502 },
    );
  }
}
