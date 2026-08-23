"use client";

import Link from "next/link";
import { useState } from "react";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import { loginHref } from "@/lib/auth";

import styles from "./credential-auth-experience.module.css";

type ProviderFlags = { naver: boolean; kakao: boolean };

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
          <h1>{isSignup ? "빠르게 WHICH 계정을 만들어요." : "내 WHICH 계정으로 들어가요."}</h1>
          <p className={styles.description}>
            {isSignup
              ? "이메일과 비밀번호만 정하면 됩니다. Handle과 소개는 나중에 설정할 수 있어요."
              : "이메일·비밀번호 또는 연결해 둔 소셜 수단 중 편한 방법을 선택하세요."}
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
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
                required
                minLength={isSignup ? 15 : 1}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {isSignup ? <small>15자 이상의 문장형 비밀번호를 권장해요.</small> : null}
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
                  에 동의하고 계정을 만듭니다.
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
                  {provider.label}
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
