import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { NextRequest, NextResponse } from "next/server";

export const ANALYTICS_SESSION_COOKIE = "which_analytics_session";
const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signatureContext = "which-analytics-session-v1\0";

type SessionCookie = { version: 1; id: string; touchedAt: number };

function secret() {
  const value = process.env.ANALYTICS_SESSION_SECRET ?? process.env.AUTH_FLOW_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ANALYTICS_SESSION_SECRET or AUTH_FLOW_SECRET is required in production.");
  }
  return "which-local-analytics-session-secret-change-me";
}

function signature(payload: string) {
  return createHmac("sha256", secret())
    .update(signatureContext)
    .update(payload)
    .digest("base64url");
}

function decode(value: string | undefined, now: number): SessionCookie | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SessionCookie>;
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== "string" ||
      !uuidPattern.test(parsed.id) ||
      typeof parsed.touchedAt !== "number" ||
      !Number.isInteger(parsed.touchedAt) ||
      parsed.touchedAt > now + 5 * 60 * 1_000 ||
      now - parsed.touchedAt > SESSION_IDLE_MILLISECONDS
    ) {
      return null;
    }
    return parsed as SessionCookie;
  } catch {
    return null;
  }
}

function encode(session: SessionCookie) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function analyticsSessionForRequest(request: NextRequest, now = Date.now()) {
  const existing = decode(request.cookies.get(ANALYTICS_SESSION_COOKIE)?.value, now);
  return { version: 1 as const, id: existing?.id ?? randomUUID(), touchedAt: now };
}

export function setAnalyticsSessionCookie(response: NextResponse, session: SessionCookie) {
  response.cookies.set({
    name: ANALYTICS_SESSION_COOKIE,
    value: encode(session),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_IDLE_MILLISECONDS / 1_000,
  });
}
