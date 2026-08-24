"use client";

import { useState } from "react";

import styles from "./member-credential-setup.module.css";

export function MemberCredentialSetup({ onCompleted }: { onCompleted: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className={styles.panel} aria-labelledby="credential-setup-title">
      <div>
        <p>COMPLETE YOUR WHICH ACCOUNT</p>
        <h2 id="credential-setup-title">소셜 로그인이 없어도 들어올 수 있게 해둘까요?</h2>
        <span>
          이메일과 WHICH 비밀번호를 한 번 설정하면 모든 연결된 로그인 수단이 같은 Member로
          이어집니다.
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          void fetch("/api/auth/credentials/complete", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-which-csrf": "member-auth" },
            body: JSON.stringify({ email, password }),
          })
            .then(async (response) => {
              const body = (await response.json()) as { message?: string; returnTo?: string };
              if (!response.ok) throw new Error(body.message || "설정을 완료하지 못했습니다.");
              onCompleted();
              window.location.assign(body.returnTo || "/verify-email");
            })
            .catch((reason: unknown) =>
              setError(reason instanceof Error ? reason.message : "다시 시도해 주세요."),
            )
            .finally(() => setPending(false));
        }}
      >
        <input
          aria-label="로그인 이메일"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          placeholder="email@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          aria-label="새 WHICH 비밀번호"
          type="password"
          autoComplete="new-password"
          required
          minLength={15}
          maxLength={128}
          placeholder="15자 이상의 비밀번호"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={pending}>
          {pending ? "설정 중…" : "이메일 로그인 설정"}
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
