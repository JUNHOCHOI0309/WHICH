import { NextResponse } from "next/server";
import { fetchWhichApi } from "@/lib/server/which-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetchWhichApi("/health/ready", { signal: AbortSignal.timeout(3_000) });
    if (response.ok) {
      return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    // Health responses must not expose database connection details or credentials.
  }
  return NextResponse.json(
    { status: "unavailable" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
