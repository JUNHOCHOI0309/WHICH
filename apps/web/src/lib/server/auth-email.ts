import { authBaseUrl, internalAuthSecret } from "./member-auth";
import { fetchWhichApi } from "./which-api";

type AuthEmailDelivery = { email: string; token: string; expiresAt: string };
type AuthEmailPurpose = "verification" | "password-reset";

async function internalAuthRequest<T>(path: string, body: Record<string, string>) {
  const response = await fetchWhichApi(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { code?: string };
  if (!response.ok) {
    const error = new Error("WHICH authentication request failed.");
    Object.assign(error, { code: result.code, status: response.status });
    throw error;
  }
  return result;
}

export function requestEmailVerification(email: string, authRequestKey: string) {
  return internalAuthRequest<AuthEmailDelivery | null>(
    "/v1/internal/member-email-verification-requests",
    { email, authRequestKey },
  );
}

export function confirmEmailVerification(token: string, authRequestKey: string) {
  return internalAuthRequest<{ verified: true }>("/v1/internal/member-email-verifications", {
    token,
    authRequestKey,
  });
}

export function requestPasswordReset(email: string, authRequestKey: string) {
  return internalAuthRequest<AuthEmailDelivery | null>(
    "/v1/internal/member-password-reset-requests",
    { email, authRequestKey },
  );
}

export function confirmPasswordReset(token: string, password: string, authRequestKey: string) {
  return internalAuthRequest<{ reset: true }>("/v1/internal/member-password-resets", {
    token,
    password,
    authRequestKey,
  });
}

function emailContent(purpose: AuthEmailPurpose) {
  if (purpose === "verification") {
    return {
      subject: "WHICH 이메일을 확인해 주세요",
      heading: "이메일 확인을 마치면 다음 로그인부터 안전하게 이어집니다.",
      action: "이메일 확인하기",
      note: "이 링크는 24시간 동안 한 번만 사용할 수 있습니다.",
    };
  }
  return {
    subject: "WHICH 비밀번호 재설정",
    heading: "요청하신 비밀번호 재설정 링크입니다.",
    action: "비밀번호 다시 정하기",
    note: "이 링크는 30분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 무시하세요.",
  };
}

export async function sendAuthEmail(
  delivery: AuthEmailDelivery,
  purpose: AuthEmailPurpose,
  requestUrl: string,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) return false;

  const baseUrl = authBaseUrl(requestUrl);
  const path =
    purpose === "verification" ? "/api/auth/email-verification/confirm" : "/reset-password";
  const link = new URL(path, baseUrl);
  link.searchParams.set("token", delivery.token);
  const content = emailContent(purpose);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [delivery.email],
      subject: content.subject,
      ...(process.env.AUTH_EMAIL_REPLY_TO ? { reply_to: process.env.AUTH_EMAIL_REPLY_TO } : {}),
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h1>${content.heading}</h1><p><a href="${link.toString()}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#16c4d4;color:#082f49;text-decoration:none;font-weight:700">${content.action}</a></p><p>${content.note}</p><p>WHICH · Your choice, privately.</p></div>`,
      text: `${content.heading}\n\n${content.action}: ${link.toString()}\n\n${content.note}`,
    }),
  });
  if (!response.ok) throw new Error(`Transactional email delivery failed (${response.status}).`);
  return true;
}
