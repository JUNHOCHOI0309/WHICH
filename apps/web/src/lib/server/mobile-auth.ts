import { fetchWhichApi } from "./which-api";

const proofPattern = /^[A-Za-z0-9._~-]{32,128}$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const providers = ["email", "google", "x", "naver", "kakao"] as const;

export type MobileAuthProvider = (typeof providers)[number];

export type MobileAuthRequest = {
  state: string;
  nonce: string;
  codeChallenge: string;
  provider: MobileAuthProvider;
};

export function readMobileAuthRequest(searchParams: URLSearchParams): MobileAuthRequest | null {
  const state = searchParams.get("state");
  const nonce = searchParams.get("nonce");
  const codeChallenge = searchParams.get("code_challenge");
  const requestedProvider = searchParams.get("provider") ?? "email";
  if (
    !state ||
    !nonce ||
    !codeChallenge ||
    !proofPattern.test(state) ||
    !proofPattern.test(nonce) ||
    !challengePattern.test(codeChallenge) ||
    !providers.includes(requestedProvider as MobileAuthProvider)
  ) {
    return null;
  }
  return { state, nonce, codeChallenge, provider: requestedProvider as MobileAuthProvider };
}

export function mobileAuthCompletionPath(
  request: MobileAuthRequest,
  phase: "start" | "callback" = "start",
) {
  const search = new URLSearchParams({
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    provider: request.provider,
    phase,
  });
  return `/mobile-auth/complete?${search.toString()}`;
}

export function mobileAuthCallbackUrl(
  request: Pick<MobileAuthRequest, "state" | "nonce">,
  result: { ticket: string } | { error: string },
) {
  const target = new URL("which://auth/callback");
  target.searchParams.set("state", request.state);
  target.searchParams.set("nonce", request.nonce);
  if ("ticket" in result) target.searchParams.set("ticket", result.ticket);
  else target.searchParams.set("error", result.error);
  return target;
}

export async function issueMobileAuthExchangeTicket(
  sessionToken: string,
  request: MobileAuthRequest,
) {
  const upstream = await fetchWhichApi("/v1/mobile-auth/exchange-tickets", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      state: request.state,
      nonce: request.nonce,
      codeChallenge: request.codeChallenge,
    }),
  });
  const body = (await upstream.json()) as {
    ticket?: string;
    expiresAt?: string;
    code?: string;
  };
  return { upstream, body };
}
