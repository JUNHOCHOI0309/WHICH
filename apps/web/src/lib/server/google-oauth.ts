import * as oidc from "openid-client";
import { NextResponse } from "next/server";

import {
  AUTH_FLOW_COOKIE,
  AUTH_FLOW_COOKIE_PATH,
  type AuthFlow,
  encodeAuthFlow,
  encodeGoogleBrowserHandoff,
  googleOidcCredentials,
  withAuthOutcome,
} from "./member-auth";

export function googleCallbackUrl(baseUrl: URL) {
  return new URL("/api/auth/google/callback", baseUrl).toString();
}

export function googleTokenRequestBody(body: unknown, redirectUri: string) {
  if (body instanceof URLSearchParams && body.get("grant_type") === "authorization_code") {
    const pinnedBody = new URLSearchParams(body);
    pinnedBody.set("redirect_uri", redirectUri);
    return pinnedBody;
  }

  return body;
}

export function pinGoogleTokenRedirectUri(config: oidc.Configuration, redirectUri: string) {
  config[oidc.customFetch] = (url, options) => {
    const requestOptions = options as RequestInit;
    return fetch(url, {
      ...requestOptions,
      body: googleTokenRequestBody(options.body, redirectUri) as BodyInit,
    });
  };
}

export async function startGoogleAuthorization(input: {
  baseUrl: URL;
  returnTo: string;
  anonymousSubjectId?: string;
  flow?: Pick<AuthFlow, "state" | "nonce" | "codeVerifier">;
}) {
  const credentials = googleOidcCredentials();
  if (!credentials) {
    return NextResponse.redirect(
      new URL(withAuthOutcome(input.returnTo, "unavailable"), input.baseUrl),
    );
  }

  try {
    const config = await oidc.discovery(
      new URL("https://accounts.google.com"),
      credentials.clientId,
      credentials.clientSecret,
    );
    const codeVerifier = input.flow?.codeVerifier ?? oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = input.flow?.state ?? oidc.randomState();
    const nonce = input.flow?.nonce ?? oidc.randomNonce();
    const redirectUri = googleCallbackUrl(input.baseUrl);
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid profile",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set({
      name: AUTH_FLOW_COOKIE,
      value: encodeAuthFlow({
        provider: "GOOGLE",
        state,
        nonce,
        codeVerifier,
        returnTo: input.returnTo,
        anonymousSubjectId: input.anonymousSubjectId,
        createdAt: Date.now(),
      }),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: AUTH_FLOW_COOKIE_PATH,
      maxAge: 10 * 60,
    });
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  } catch {
    console.warn(JSON.stringify({ event: "google_auth_failed", stage: "authorization_start" }));
    return NextResponse.redirect(new URL(withAuthOutcome(input.returnTo, "error"), input.baseUrl));
  }
}

export function createGoogleBrowserHandoffTicket(input: {
  returnTo: string;
  anonymousSubjectId?: string;
}) {
  return encodeGoogleBrowserHandoff({
    ...input,
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    codeVerifier: oidc.randomPKCECodeVerifier(),
    createdAt: Date.now(),
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function googleExternalBrowserPage(baseUrl: URL, ticket: string) {
  const handoffUrl = new URL("/api/auth/google/handoff", baseUrl);
  handoffUrl.searchParams.set("ticket", ticket);
  const scheme = handoffUrl.protocol.slice(0, -1);
  const intentTarget = `${handoffUrl.host}${handoffUrl.pathname}${handoffUrl.search}`;
  const intentUrl = `intent://${intentTarget}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(handoffUrl.toString())};end`;
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>브라우저에서 Google 로그인 · WHICH</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; background: #061923; color: #061923; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
      main { width: min(100%, 520px); background: #eefbfc; border: 2px solid #061923; padding: 32px; box-sizing: border-box; }
      p { color: #526a72; line-height: 1.65; }
      a { display: block; margin-top: 24px; padding: 18px 20px; background: #20c4d2; border: 2px solid #061923; color: #061923; font-weight: 800; text-align: center; text-decoration: none; }
      small { display: block; margin-top: 20px; color: #657980; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <p>SECURE LOGIN</p>
      <h1>Chrome에서 Google 로그인을 계속해 주세요</h1>
      <p>카카오톡 같은 앱 내부 브라우저에서는 Google 로그인이 중단될 수 있어요. 아래 버튼을 누르면 안전한 외부 브라우저에서 이어집니다.</p>
      <a href="${escapeHtml(intentUrl)}" rel="noreferrer">Chrome에서 계속</a>
      <small>버튼이 열리지 않으면 우측 상단 메뉴에서 ‘다른 브라우저로 열기’를 선택한 뒤 다시 로그인해 주세요. 이 연결은 2분 뒤 만료됩니다.</small>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}
