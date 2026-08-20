import { type NextRequest, NextResponse } from "next/server";

import {
  decodeEntryAttribution,
  encodeEntryAttribution,
  ENTRY_ATTRIBUTION_COOKIE,
  ENTRY_ATTRIBUTION_MAX_AGE_SECONDS,
  entryAttributionFromSearchParams,
} from "@/lib/server/entry-attribution";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (request.method !== "GET") return response;

  const existing = request.cookies.get(ENTRY_ATTRIBUTION_COOKIE)?.value;
  if (decodeEntryAttribution(existing)) return response;

  const attribution = entryAttributionFromSearchParams(request.nextUrl.searchParams);
  if (!attribution) return response;

  response.cookies.set({
    name: ENTRY_ATTRIBUTION_COOKIE,
    value: encodeEntryAttribution(attribution),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ENTRY_ATTRIBUTION_MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
