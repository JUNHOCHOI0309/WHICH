type XOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

type XProfile = {
  id: string;
  name: string | null;
  username: string | null;
  profileImageUrl: string | null;
};

export function buildXAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "users.read tweet.read");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export async function exchangeXAuthorizationCode(
  input: {
    credentials: XOAuthCredentials;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  request: typeof fetch = fetch,
) {
  const basic = Buffer.from(
    `${input.credentials.clientId}:${input.credentials.clientSecret}`,
  ).toString("base64");
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const response = await request("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const payload = (await response.json()) as { access_token?: unknown };
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("X token exchange failed.");
  }
  return payload.access_token;
}

export async function fetchXProfile(accessToken: string, request: typeof fetch = fetch) {
  const url = new URL("https://api.x.com/2/users/me");
  url.searchParams.set("user.fields", "profile_image_url");
  const response = await request(url, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    data?: { id?: unknown; name?: unknown; username?: unknown; profile_image_url?: unknown };
  };
  if (!response.ok || typeof payload.data?.id !== "string" || !payload.data.id) {
    throw new Error("X authenticated user lookup failed.");
  }
  return {
    id: payload.data.id,
    name: typeof payload.data.name === "string" ? payload.data.name : null,
    username: typeof payload.data.username === "string" ? payload.data.username : null,
    profileImageUrl:
      typeof payload.data.profile_image_url === "string" ? payload.data.profile_image_url : null,
  } satisfies XProfile;
}

export function xDisplayName(profile: XProfile) {
  return profile.name ?? (profile.username ? `@${profile.username}` : "WHICH 회원");
}
