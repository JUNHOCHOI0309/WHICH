import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const AUTH_FLOW_COOKIE = "which_auth_flow";
export const AUTH_FLOW_COOKIE_PATH = "/api/auth";
export const SOCIAL_SIGNUP_COOKIE = "which_social_signup";

export type AuthProvider = "GOOGLE" | "X" | "NAVER" | "KAKAO";
export type AuthOutcome = "success" | "cancelled" | "error" | "unavailable" | "merge-review";

export type AuthFlow = {
  provider: AuthProvider;
  state: string;
  nonce?: string;
  codeVerifier: string;
  returnTo: string;
  anonymousSubjectId?: string;
  intent?: "LINK";
  linkMemberId?: string;
  createdAt: number;
};

export type GoogleBrowserHandoff = {
  version: 1;
  provider: "GOOGLE";
  returnTo: string;
  anonymousSubjectId?: string;
  linkMemberId?: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
};

export type SocialSignupTicket = {
  version: 1;
  provider: AuthProvider;
  providerSubject: string;
  displayName: string;
  avatarUrl?: string;
  suggestedEmail?: string;
  anonymousSubjectId?: string;
  returnTo: string;
  createdAt: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOOGLE_HANDOFF_CONTEXT = "which-google-browser-handoff-v1\0";
const SOCIAL_SIGNUP_CONTEXT = "which-social-signup-v1\0";
const GOOGLE_HANDOFF_MAX_AGE_MILLISECONDS = 2 * 60 * 1_000;
const SOCIAL_SIGNUP_MAX_AGE_MILLISECONDS = 10 * 60 * 1_000;

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

export function withAuthOutcome(returnTo: string, outcome: AuthOutcome) {
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

function googleHandoffKey() {
  return createHash("sha256").update(GOOGLE_HANDOFF_CONTEXT).update(flowSecret()).digest();
}

function socialSignupKey() {
  return createHash("sha256").update(SOCIAL_SIGNUP_CONTEXT).update(flowSecret()).digest();
}

export function encodeSocialSignupTicket(input: Omit<SocialSignupTicket, "version">) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", socialSignupKey(), iv);
  cipher.setAAD(Buffer.from(SOCIAL_SIGNUP_CONTEXT));
  const plaintext = Buffer.from(
    JSON.stringify({ version: 1, ...input } satisfies SocialSignupTicket),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decodeSocialSignupTicket(
  value: string | null | undefined,
  now = Date.now(),
): SocialSignupTicket | null {
  if (!value) return null;
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      socialSignupKey(),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(SOCIAL_SIGNUP_CONTEXT));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const ticket = JSON.parse(plaintext) as SocialSignupTicket;
    if (
      ticket.version !== 1 ||
      !["GOOGLE", "X", "NAVER", "KAKAO"].includes(ticket.provider) ||
      typeof ticket.providerSubject !== "string" ||
      ticket.providerSubject.length < 1 ||
      ticket.providerSubject.length > 255 ||
      typeof ticket.displayName !== "string" ||
      ticket.displayName.length < 1 ||
      ticket.displayName.length > 160 ||
      (ticket.avatarUrl !== undefined &&
        (typeof ticket.avatarUrl !== "string" || ticket.avatarUrl.length > 2048)) ||
      (ticket.suggestedEmail !== undefined &&
        (typeof ticket.suggestedEmail !== "string" || ticket.suggestedEmail.length > 320)) ||
      (ticket.anonymousSubjectId !== undefined && !uuidPattern.test(ticket.anonymousSubjectId)) ||
      sanitizeReturnTo(ticket.returnTo) !== ticket.returnTo ||
      !Number.isInteger(ticket.createdAt) ||
      ticket.createdAt > now + 30_000 ||
      now - ticket.createdAt > SOCIAL_SIGNUP_MAX_AGE_MILLISECONDS
    ) {
      return null;
    }
    return ticket;
  } catch {
    return null;
  }
}

export function isEmbeddedUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return false;
  return /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|;\s*wv\)/i.test(userAgent);
}

export function encodeGoogleBrowserHandoff(
  input: Omit<GoogleBrowserHandoff, "version" | "provider">,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", googleHandoffKey(), iv);
  cipher.setAAD(Buffer.from(GOOGLE_HANDOFF_CONTEXT));
  const plaintext = Buffer.from(
    JSON.stringify({ version: 1, provider: "GOOGLE", ...input } satisfies GoogleBrowserHandoff),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decodeGoogleBrowserHandoff(
  value: string | null | undefined,
  now = Date.now(),
): GoogleBrowserHandoff | null {
  if (!value) return null;
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      googleHandoffKey(),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(GOOGLE_HANDOFF_CONTEXT));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const handoff = JSON.parse(plaintext) as GoogleBrowserHandoff;
    if (
      handoff.version !== 1 ||
      handoff.provider !== "GOOGLE" ||
      sanitizeReturnTo(handoff.returnTo) !== handoff.returnTo ||
      (handoff.anonymousSubjectId !== undefined && !uuidPattern.test(handoff.anonymousSubjectId)) ||
      (handoff.linkMemberId !== undefined && !uuidPattern.test(handoff.linkMemberId)) ||
      typeof handoff.state !== "string" ||
      handoff.state.length < 32 ||
      typeof handoff.nonce !== "string" ||
      handoff.nonce.length < 32 ||
      typeof handoff.codeVerifier !== "string" ||
      handoff.codeVerifier.length < 43 ||
      !Number.isInteger(handoff.createdAt) ||
      handoff.createdAt > now + 30_000 ||
      now - handoff.createdAt > GOOGLE_HANDOFF_MAX_AGE_MILLISECONDS
    ) {
      return null;
    }
    return handoff;
  } catch {
    return null;
  }
}

export function encodeAuthFlow(flow: AuthFlow) {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  const signature = createHmac("sha256", flowSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeAuthFlow(value: string | undefined) {
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
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthFlow;
    if (
      !["GOOGLE", "X", "NAVER", "KAKAO"].includes(flow.provider) ||
      typeof flow.state !== "string" ||
      (["GOOGLE", "KAKAO"].includes(flow.provider) && typeof flow.nonce !== "string") ||
      (flow.nonce !== undefined && typeof flow.nonce !== "string") ||
      typeof flow.codeVerifier !== "string" ||
      typeof flow.returnTo !== "string" ||
      (flow.anonymousSubjectId !== undefined && !uuidPattern.test(flow.anonymousSubjectId)) ||
      (flow.intent !== undefined && flow.intent !== "LINK") ||
      (flow.intent === "LINK") !== (flow.linkMemberId !== undefined) ||
      (flow.linkMemberId !== undefined && !uuidPattern.test(flow.linkMemberId)) ||
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

export function authFlowMatches(
  flow: AuthFlow,
  provider: AuthProvider,
  returnedState: string | null,
) {
  if (flow.provider !== provider || !returnedState) return false;
  const expected = Buffer.from(flow.state);
  const actual = Buffer.from(returnedState);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function randomOAuthValue() {
  return randomBytes(32).toString("base64url");
}

export function authRequestKey(headers: Pick<Headers, "get">, discriminator: string) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const clientAddress =
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    forwardedFor ||
    "unknown";
  return createHmac("sha256", flowSecret())
    .update("which-auth-rate-limit-v1\0")
    .update(clientAddress)
    .update("\0")
    .update(discriminator.trim().normalize("NFKC").toLowerCase())
    .digest("hex");
}

export function calculateS256CodeChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function authBaseUrl(requestUrl: string) {
  const configured = process.env.AUTH_BASE_URL;
  if (configured) return new URL(configured);
  return new URL(new URL(requestUrl).origin);
}

export function googleOidcCredentials() {
  const clientId = process.env.GOOGLE_OIDC_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function xOAuthCredentials() {
  const clientId = process.env.X_OAUTH_CLIENT_ID;
  const clientSecret = process.env.X_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function naverOidcCredentials() {
  const clientId = process.env.NAVER_OIDC_CLIENT_ID;
  const clientSecret = process.env.NAVER_OIDC_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function naverLoginEnabled() {
  return process.env.FEATURE_NAVER_LOGIN_ENABLED === "true";
}

export function kakaoOidcCredentials() {
  const clientId = process.env.KAKAO_OIDC_CLIENT_ID;
  const clientSecret = process.env.KAKAO_OIDC_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function kakaoLoginEnabled() {
  return process.env.FEATURE_KAKAO_LOGIN_ENABLED === "true";
}

export function internalAuthSecret() {
  const configured = process.env.AUTH_INTERNAL_SECRET || process.env.INTERNAL_AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_INTERNAL_SECRET or INTERNAL_AUTH_SECRET is required in production.");
  }
  return "which-local-internal-auth-secret";
}
