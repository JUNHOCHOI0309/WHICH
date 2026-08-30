"use client";

import Link from "next/link";
import { useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import { loginHref } from "@/lib/auth";
import {
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_REQUIREMENT,
  newPasswordPolicyError,
} from "@/lib/password-policy";

import styles from "./credential-auth-experience.module.css";

type ProviderFlags = { naver: boolean; kakao: boolean; tiktok?: boolean };

async function submitCredential(input: {
  mode: "login" | "signup";
  email: string;
  password: string;
  termsAccepted: boolean;
  returnTo: string;
}) {
  const response = await fetch("/api/auth/credentials", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-which-csrf": "member-auth" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { message?: string; returnTo?: string };
  if (!response.ok) throw new Error(body.message || "계정 처리를 완료하지 못했습니다.");
  if (input.mode === "login") toast.flash({ message: "로그인했어요.", tone: "success" });
  window.location.assign(body.returnTo || input.returnTo);
}

export function CredentialAuthExperience({
  mode,
  returnTo,
  providers,
}: {
  mode: "login" | "signup";
  returnTo: string;
  providers: ProviderFlags;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSignup = mode === "signup";
  const social = [
    { id: "google", label: "Google로 계속하기", enabled: true },
    { id: "naver", label: "네이버로 계속하기", enabled: providers.naver },
    { id: "kakao", label: "카카오로 계속하기", enabled: providers.kakao },
    { id: "x", label: "X로 계속하기", enabled: true },
    { id: "tiktok", label: "TikTok으로 계속하기", enabled: providers.tiktok === true },
  ] as const;

  return (
    <WhichShell
      aside={
        <WhichAsideCard
          eyebrow="ONE MEMBER"
          title="어떤 방법으로 들어와도 기록은 하나로 이어져요."
          tone="orange"
        >
          소셜 인증을 사용하더라도 WHICH 계정은 한 명의 Member로 관리됩니다.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>ONE ACCOUNT, MANY WAYS IN</p>
          <h1>
            {isSignup ? (
              "빠르게 WHICH 계정을 만들어요."
            ) : (
              <>
                <span className={styles.wordmarkAccent}>W</span>HICH
              </>
            )}
          </h1>
          <p className={styles.description}>
            {isSignup
              ? "이메일과 비밀번호만 정하면 됩니다. Handle과 소개는 나중에 설정할 수 있어요."
              : "이메일·비밀번호 또는 연결해 둔 소셜 수단 중 편한 방법을 선택하세요."}
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const policyError = isSignup ? newPasswordPolicyError(password) : null;
              if (policyError) {
                setError(policyError);
                return;
              }
              setPending(true);
              setError(null);
              void submitCredential({ mode, email, password, termsAccepted, returnTo })
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
                name="email"
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
                name="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                aria-describedby={isSignup ? "credential-password-requirement" : undefined}
                required
                minLength={isSignup ? NEW_PASSWORD_MIN_LENGTH : 1}
                maxLength={isSignup ? NEW_PASSWORD_MAX_LENGTH : 128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {isSignup ? (
                <small id="credential-password-requirement">{NEW_PASSWORD_REQUIREMENT}</small>
              ) : null}
            </label>
            {isSignup ? (
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
                  신고·권리 요청 결과에 따라 공개가 제한될 수 있음을 확인합니다. 이미지 질문을
                  이용할 때의 OpenAI 국외 처리와 보존 조건도 확인합니다.
                </span>
              </label>
            ) : null}
            <button type="submit" disabled={pending}>
              {pending ? "처리 중…" : isSignup ? "WHICH 계정 만들기" : "로그인"}
            </button>
          </form>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {!isSignup ? (
            <p className={styles.recoveryLink}>
              <Link href="/forgot-password">비밀번호를 잊었거나 이메일 확인이 필요한가요?</Link>
            </p>
          ) : null}

          <div className={styles.divider}>
            <span>또는</span>
          </div>
          <div className={styles.social} aria-label="소셜 로그인">
            {social
              .filter((provider) => provider.enabled)
              .map((provider) => (
                <a
                  key={provider.id}
                  href={loginHref(provider.id, returnTo)}
                  data-provider={provider.id}
                >
                  {provider.id === "tiktok" ? (
                    <span>
                      <span className={styles.tiktokWordmark}>TikTok</span>으로 계속하기
                    </span>
                  ) : (
                    provider.label
                  )}
                </a>
              ))}
          </div>

          <p className={styles.switch}>
            {isSignup ? "이미 WHICH 계정이 있나요?" : "아직 WHICH 계정이 없나요?"}{" "}
            <Link
              href={`${isSignup ? "/login" : "/signup"}?returnTo=${encodeURIComponent(returnTo)}`}
            >
              {isSignup ? "로그인" : "빠른 회원가입"}
            </Link>
          </p>
        </section>
      </div>
    </WhichShell>
  );
}
