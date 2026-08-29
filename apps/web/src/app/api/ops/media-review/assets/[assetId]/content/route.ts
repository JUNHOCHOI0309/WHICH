import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeOpsRequest } from "@/lib/server/ops-api";
import { internalAuthSecret } from "@/lib/server/member-auth";
import { clearMemberSessionCookie, fetchWhichApi } from "@/lib/server/which-api";

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const authorization = await authorizeOpsRequest(request);
  if (authorization.response || !authorization.token) return authorization.response!;
  const { assetId } = await context.params;
  try {
    const upstream = await fetchWhichApi(
      `/v1/internal/ops/media-review/assets/${encodeURIComponent(assetId)}/content`,
      {
        headers: {
          authorization: `Bearer ${authorization.token}`,
          "x-internal-auth-secret": internalAuthSecret(),
        },
      },
    );
    if (!upstream.ok) {
      const response = NextResponse.json(await upstream.json(), { status: upstream.status });
      if (upstream.status === 401) clearMemberSessionCookie(response);
      return response;
    }
    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "이미지를 불러오지 못했습니다." }, { status: 502 });
  }
}
