import type { NextRequest } from "next/server";

export function publicOriginForRequest(request: NextRequest) {
  if (process.env.AUTH_BASE_URL) {
    try {
      return new URL(process.env.AUTH_BASE_URL).origin;
    } catch {
      // Fall back to the request URL when configuration is malformed.
    }
  }

  return request.nextUrl.origin;
}

export function hasSamePublicOrigin(request: NextRequest) {
  return request.headers.get("origin") === publicOriginForRequest(request);
}
