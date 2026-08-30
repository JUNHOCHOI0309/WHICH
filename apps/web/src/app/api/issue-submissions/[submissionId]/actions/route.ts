import { type NextRequest, NextResponse } from "next/server";
import { fetchWhichApi, MEMBER_SESSION_COOKIE } from "@/lib/server/which-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  const token = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ code: "SESSION_REQUIRED" }, { status: 401 });
  if (!hasSamePublicOrigin(request))
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const { submissionId } = await context.params;
  const upstream = await fetchWhichApi(
    `/v1/member/issue-submissions/${encodeURIComponent(submissionId)}/actions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: await request.text(),
    },
  );
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
