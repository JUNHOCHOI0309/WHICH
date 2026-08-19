import { createHmac, timingSafeEqual } from "node:crypto";

export const OIDC_FLOW_COOKIE = "which_oidc_flow";

export type OidcFlow = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
};

export function sanitizeReturnTo(value: string | null | undefined) {
  if (!value) return "/";
  try {
    const parsed = new URL(value, "http://which.local");
    if (parsed.origin !== "http://which.local" || !parsed.pathname.startsWith("/")) return "/";
    if (parsed.pathname.startsWith("//") || parsed.pathname.startsWith("/api/auth/")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function withAuthOutcome(
  returnTo: string,
  outcome: "success" | "cancelled" | "error" | "unavailable",
) {
  const target = new URL(sanitizeReturnTo(returnTo), "http://which.local");
  target.searchParams.set("auth", outcome);
  return `${target.pathname}${target.search}${target.hash}`;
}

function flowSecret() {
  const configured = process.env.AUTH_FLOW_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production")
    throw new Error("AUTH_FLOW_SECRET is required in production.");
  return "which-local-auth-flow-secret-change-me";
}

export function encodeOidcFlow(flow: OidcFlow) {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  const signature = createHmac("sha256", flowSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeOidcFlow(value: string | undefined) {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", flowSecret()).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OidcFlow;
    if (
      typeof flow.state !== "string" ||
      typeof flow.nonce !== "string" ||
      typeof flow.codeVerifier !== "string" ||
      typeof flow.returnTo !== "string" ||
      typeof flow.createdAt !== "number" ||
      Date.now() - flow.createdAt > 10 * 60 * 1_000
    ) {
      return null;
    }
    return flow;
  } catch {
    return null;
  }
}

export function authBaseUrl(requestUrl: string) {
  const configured = process.env.AUTH_BASE_URL;
  if (configured) return new URL(configured);
  return new URL(requestUrl).origin;
}

export function googleOidcCredentials() {
  const clientId = process.env.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function internalAuthSecret() {
  const configured = process.env.AUTH_INTERNAL_SECRET || process.env.INTERNAL_AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_INTERNAL_SECRET or INTERNAL_AUTH_SECRET is required in production.");
  }
  return "which-local-internal-auth-secret";
}
