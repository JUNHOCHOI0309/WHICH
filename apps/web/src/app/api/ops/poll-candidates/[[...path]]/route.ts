import { NextRequest, NextResponse } from "next/server";
import { proxyOpsApi } from "@/lib/server/ops-api";
import { hasSamePublicOrigin } from "@/lib/server/request-origin";

type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const route = path.join("/");
  const uuid = "[0-9a-fA-F-]{36}";
  const valid =
    request.method === "GET"
      ? !route
      : request.method === "POST"
        ? route === "import" || new RegExp(`^${uuid}/review$`).test(route)
        : request.method === "PATCH" && new RegExp(`^${uuid}$`).test(route);
  if (!valid)
    return NextResponse.json({ message: "요청 경로가 올바르지 않습니다." }, { status: 404 });
  if (request.method !== "GET" && !hasSamePublicOrigin(request))
    return NextResponse.json({ message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  return proxyOpsApi(
    request,
    `/v1/internal/ops/poll-candidates${route ? `/${route}` : ""}${request.nextUrl.search}`,
    {
      method: request.method,
      ...(request.method !== "GET"
        ? { headers: { "content-type": "application/json" }, body: await request.text() }
        : {}),
    },
  );
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
