import { sanitizeReturnTo } from "./member-auth";

const AUTHORIZATION_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_INFO_URL =
  "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url";
const BASIC_SCOPE = "user.info.basic";

export function tiktokOAuthConfiguration() {
  if (process.env.FEATURE_TIKTOK_LOGIN_ENABLED !== "true") return null;
  const clientKey = process.env.TIKTOK_OAUTH_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_OAUTH_CLIENT_SECRET?.trim();
  try {
    const baseUrl = new URL(process.env.AUTH_BASE_URL ?? "");
    if (
      !clientKey ||
      !clientSecret ||
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.pathname !== "/" ||
      baseUrl.search ||
      baseUrl.hash
    )
      return null;
    return {
      clientKey,
      clientSecret,
      baseUrl,
      redirectUri: new URL("/api/auth/tiktok/callback", baseUrl).toString(),
    };
  } catch {
    return null;
  }
}

// Native Login Kit is a separate release gate. Do not issue an app handoff via Web login.
export function tiktokWebReturnToAllowed(returnTo: string) {
  try {
    const pathname = decodeURIComponent(
      new URL(sanitizeReturnTo(returnTo), "https://which.local").pathname,
    );
    return !/^\/(?:mobile-auth|api\/mobile)(?:\/|$)/i.test(pathname);
  } catch {
    return false;
  }
}

export function tiktokLoginAvailable(returnTo = "/") {
  return tiktokWebReturnToAllowed(returnTo) && tiktokOAuthConfiguration() !== null;
}

type Configuration = NonNullable<ReturnType<typeof tiktokOAuthConfiguration>>;

export function buildTikTokAuthorizationUrl(configuration: Configuration, state: string) {
  const url = new URL(AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_key: configuration.clientKey,
    response_type: "code",
    scope: BASIC_SCOPE,
    redirect_uri: configuration.redirectUri,
    state,
    disable_auto_auth: "1",
  }).toString();
  return url;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function providerJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("TikTok request failed.");
  const text = await response.text();
  if (text.length > 65_536) throw new Error("TikTok response is too large.");
  return record(JSON.parse(text));
}

function safeAvatar(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const allowed = ["tiktokcdn.com", "tiktokcdn-us.com"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function authenticateTikTokCode(configuration: Configuration, code: string) {
  // Web Login Kit is OAuth 2.0, not OIDC. Tokens are used only in this request.
  const token = await providerJson(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_key: configuration.clientKey,
      client_secret: configuration.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: configuration.redirectUri,
    }).toString(),
  });
  if (
    token.error ||
    typeof token.access_token !== "string" ||
    !token.access_token ||
    typeof token.open_id !== "string" ||
    !token.open_id ||
    token.open_id.length > 255 ||
    typeof token.scope !== "string" ||
    !token.scope
      .split(",")
      .map((scope) => scope.trim())
      .includes(BASIC_SCOPE) ||
    typeof token.token_type !== "string" ||
    token.token_type.toLowerCase() !== "bearer"
  ) {
    throw new Error("TikTok authorization is incomplete.");
  }
  const profile = await providerJson(USER_INFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const user = record(record(profile.data).user);
  if (record(profile.error).code !== "ok" || user.open_id !== token.open_id) {
    throw new Error("TikTok identity could not be verified.");
  }
  return {
    providerSubject: token.open_id,
    displayName:
      typeof user.display_name === "string" && user.display_name.trim()
        ? user.display_name.trim().slice(0, 160)
        : "TikTok 회원",
    avatarUrl: safeAvatar(user.avatar_url),
  };
}
