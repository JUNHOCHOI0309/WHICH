"use client";

import Link from "next/link";
import { useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import {
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_REQUIREMENT,
  newPasswordPolicyError,
} from "@/lib/password-policy";
import styles from "./credential-auth-experience.module.css";

const providerLabels = { GOOGLE: "Google", X: "X", NAVER: "네이버", KAKAO: "카카오" } as const;

export function SocialSignupExperience({
  provider,
  suggestedEmail,
}: {
  provider: keyof typeof providerLabels;
  suggestedEmail?: string;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [email, setEmail] = useState(suggestedEmail ?? "");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <WhichShell
      aside={
        <WhichAsideCard
          eyebrow={`${providerLabels[provider]} VERIFIED`}
          title="인증은 끝났고 계정 연결만 남았어요."
          tone="orange"
        >
          새 계정을 만들거나 기존 WHICH 계정에 안전하게 연결할 수 있습니다.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>{providerLabels[provider]} AUTHENTICATED</p>
          <h1>{mode === "new" ? "WHICH 계정만 완성하면 돼요." : "기존 WHICH 계정에 연결해요."}</h1>
          <p className={styles.description}>
            {mode === "new"
              ? `${providerLabels[provider]} 인증은 끝났습니다. 이메일과 WHICH 비밀번호를 정하면 Guest 기록도 함께 이어집니다.`
              : "기존 WHICH 계정의 이메일과 비밀번호로 본인 확인하면 이 로그인 수단을 연결합니다."}
          </p>

          <div className={styles.modeSwitch} role="group" aria-label="계정 처리 방식">
            <button
              type="button"
              aria-pressed={mode === "new"}
              onClick={() => {
                setMode("new");
                setError(null);
              }}
            >
              새 계정 만들기
            </button>
            <button
              type="button"
              aria-pressed={mode === "existing"}
              onClick={() => {
                setMode("existing");
                setError(null);
              }}
            >
              기존 계정에 연결
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const policyError = mode === "new" ? newPasswordPolicyError(password) : null;
              if (policyError) {
                setError(policyError);
                return;
              }
              setPending(true);
              setError(null);
              void fetch("/api/auth/signup/social", {
                method: "POST",
                cache: "no-store",
                credentials: "same-origin",
                headers: { "content-type": "application/json", "x-which-csrf": "member-auth" },
                body: JSON.stringify({ mode, email, password, termsAccepted }),
              })
                .then(async (response) => {
                  const body = (await response.json()) as { message?: string; returnTo?: string };
                  if (!response.ok) throw new Error(body.message || "가입을 완료하지 못했습니다.");
                  toast.flash({
                    message:
                      mode === "new" ? "WHICH 계정을 만들었어요." : "로그인 수단을 연결했어요.",
                    tone: "success",
                  });
                  window.location.assign(body.returnTo || "/me");
                })
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : "다시 시도해 주세요."),
                )
                .finally(() => setPending(false));
            }}
          >
            <label>
              이메일
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              WHICH 비밀번호
              <input
                type="password"
                autoComplete={mode === "new" ? "new-password" : "current-password"}
                aria-describedby={mode === "new" ? "social-password-requirement" : undefined}
                required
                minLength={mode === "new" ? NEW_PASSWORD_MIN_LENGTH : 1}
                maxLength={mode === "new" ? NEW_PASSWORD_MAX_LENGTH : 128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {mode === "new" ? (
                <small id="social-password-requirement">{NEW_PASSWORD_REQUIREMENT}</small>
              ) : null}
            </label>
            {mode === "new" ? (
              <label className={styles.terms}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  required
                />
                <span>
                  <Link href="/legal/terms" target="_blank">
                    서비스 이용약관
                  </Link>
                  과{" "}
                  <Link href="/legal/privacy" target="_blank">
                    개인정보 처리방침
                  </Link>
                  에 동의합니다. 게시하는 콘텐츠에 필요한 권리를 보유하며, 자동 안전 검수와
                  신고·권리 요청 결과에 따라 공개가 제한될 수 있음을 확인합니다.
                </span>
              </label>
            ) : null}
            <button type="submit" disabled={pending}>
              {pending
                ? "연결 중…"
                : mode === "new"
                  ? "가입하고 기록 이어받기"
                  : "확인하고 연결하기"}
            </button>
          </form>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Link className={styles.backLink} href="/login">
            다른 방법으로 로그인
          </Link>
        </section>
      </div>
    </WhichShell>
  );
}
