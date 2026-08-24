import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { MEMBER_SESSION_COOKIE } from "./which-api";

export type AnalyticsSessionContext = {
  entrySurface: "HOME" | "EXTERNAL" | "DIRECT_ISSUE" | "NATIVE" | "UNKNOWN";
  audienceSegment: "GUEST" | "MEMBER" | "UNKNOWN";
  deviceSegment: "MOBILE" | "TABLET" | "DESKTOP" | "UNKNOWN";
  trafficClass: "PRODUCT" | "TEST" | "OPERATOR" | "BOT" | "UNCLASSIFIED";
};

const botPattern =
  /bot|crawler|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|twitterbot/i;

function safeSecretMatches(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function deviceSegment(request: NextRequest): AnalyticsSessionContext["deviceSegment"] {
  const userAgent = request.headers.get("user-agent") ?? "";
  const mobileHint = request.headers.get("sec-ch-ua-mobile");
  if (/ipad|tablet|kindle|silk|playbook/i.test(userAgent)) return "TABLET";
  if (mobileHint === "?1" || /mobile|iphone|ipod|android/i.test(userAgent)) return "MOBILE";
  return userAgent ? "DESKTOP" : "UNKNOWN";
}

function entrySurface(
  request: NextRequest,
  hasAttribution: boolean,
): AnalyticsSessionContext["entrySurface"] {
  if (hasAttribution) return "EXTERNAL";
  const referer = request.headers.get("referer");
  if (!referer) return "UNKNOWN";
  try {
    const url = new URL(referer);
    if (url.origin !== request.nextUrl.origin) return "EXTERNAL";
    if (url.pathname === "/") return "HOME";
    if (url.pathname.startsWith("/issues/")) return "DIRECT_ISSUE";
  } catch {
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function trafficClass(request: NextRequest): AnalyticsSessionContext["trafficClass"] {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (botPattern.test(userAgent)) return "BOT";

  const requestedClass = request.headers.get("x-which-analytics-traffic-class");
  const suppliedSecret = request.headers.get("x-which-analytics-exclusion-secret");
  if (
    (requestedClass === "TEST" || requestedClass === "OPERATOR") &&
    safeSecretMatches(suppliedSecret, process.env.ANALYTICS_EXCLUSION_SECRET)
  ) {
    return requestedClass;
  }
  return "PRODUCT";
}

export function analyticsContextForRequest(
  request: NextRequest,
  hasAttribution: boolean,
): AnalyticsSessionContext {
  return {
    entrySurface: entrySurface(request, hasAttribution),
    audienceSegment: request.cookies.get(MEMBER_SESSION_COOKIE)?.value ? "MEMBER" : "GUEST",
    deviceSegment: deviceSegment(request),
    trafficClass: trafficClass(request),
  };
}

export function mobileAnalyticsContextForRequest(request: NextRequest): AnalyticsSessionContext {
  return {
    entrySurface: "NATIVE",
    audienceSegment: "GUEST",
    deviceSegment: "MOBILE",
    trafficClass: botPattern.test(request.headers.get("user-agent") ?? "") ? "BOT" : "PRODUCT",
  };
}
