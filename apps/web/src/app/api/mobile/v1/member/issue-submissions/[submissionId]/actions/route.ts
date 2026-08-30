import { type NextRequest, NextResponse } from "next/server";
import { fetchWhichApi } from "@/lib/server/which-api";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> },
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return NextResponse.json({ code: "SESSION_REQUIRED" }, { status: 401 });
  const { submissionId } = await context.params;
  const upstream = await fetchWhichApi(
    `/v1/member/issue-submissions/${encodeURIComponent(submissionId)}/actions`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: await request.text(),
    },
  );
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
