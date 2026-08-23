import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as confirmEmail } from "@/app/api/auth/email-verification/confirm/route";
import { POST as requestEmail } from "@/app/api/auth/email-verification/request/route";
import { POST as confirmReset } from "@/app/api/auth/password-reset/confirm/route";
import { POST as requestReset } from "@/app/api/auth/password-reset/request/route";

function postRequest(path: string, body: Record<string, string>) {
  return new NextRequest(`https://whichone.site${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-which-csrf": "member-auth",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

describe("authentication recovery BFF", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BASE_URL", "https://whichone.site");
    vi.stubEnv("AUTH_FLOW_SECRET", "recovery-test-flow-secret-with-enough-entropy");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "recovery-test-internal-secret");
    vi.stubEnv("RESEND_API_KEY", "recovery-test-resend-key");
    vi.stubEnv("AUTH_EMAIL_FROM", "WHICH <auth@whichone.site>");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends a verification email without exposing the one-time token to the browser", async () => {
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("member-email-verification-requests")) {
        const requestBody = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(requestBody.authRequestKey).toMatch(/^[a-f0-9]{64}$/);
        return Response.json({
          email: "member@example.com",
          token: "verification-secret-token-that-is-long-enough",
          expiresAt: "2026-08-25T00:00:00.000Z",
        });
      }
      expect(url).toBe("https://api.resend.com/emails");
      expect(String(init?.body)).toContain("verification-secret-token-that-is-long-enough");
      return Response.json({ id: "email-1" });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await requestEmail(
      postRequest("/api/auth/email-verification/request", { email: "member@example.com" }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("확인이 필요한 계정이라면");
    expect(body).not.toContain("verification-secret-token");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("returns the same password-reset response for an unknown account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(null)),
    );
    const response = await requestReset(
      postRequest("/api/auth/password-reset/request", { email: "missing@example.com" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "등록된 계정이라면 비밀번호 재설정 이메일을 보냈습니다.",
    });
  });

  it("consumes verification links and removes the token from the redirect URL", async () => {
    const upstream = vi.fn(async () => Response.json({ verified: true }));
    vi.stubGlobal("fetch", upstream);
    const response = await confirmEmail(
      new NextRequest(
        "https://whichone.site/api/auth/email-verification/confirm?token=verification-secret-token-that-is-long-enough",
        { headers: { "x-forwarded-for": "203.0.113.10" } },
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://whichone.site/verify-email?status=verified",
    );
    expect(response.headers.get("location")).not.toContain("token=");
  });

  it("clears the local session after a successful password reset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ reset: true })),
    );
    const response = await confirmReset(
      postRequest("/api/auth/password-reset/confirm", {
        token: "password-reset-secret-token-that-is-long-enough",
        password: "a replacement password with enough length",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("which_member_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
