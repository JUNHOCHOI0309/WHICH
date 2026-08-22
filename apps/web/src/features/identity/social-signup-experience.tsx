"use client";

import Link from "next/link";
import { useState } from "react";

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
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          WHICH<span>.</span>
        </Link>
        <Link href="/login">다른 방법으로 로그인</Link>
      </header>
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
              required
              minLength={mode === "new" ? 15 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === "new" ? (
            <label className={styles.terms}>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                required
              />
              계정 생성을 위해 이메일과 비밀번호 해시를 저장하는 데 동의합니다.
            </label>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending ? "연결 중…" : mode === "new" ? "가입하고 기록 이어받기" : "확인하고 연결하기"}
          </button>
        </form>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
