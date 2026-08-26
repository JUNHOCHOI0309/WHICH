"use client";

import { useState } from "react";

import {
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_REQUIREMENT,
  newPasswordPolicyError,
} from "@/lib/password-policy";

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
        <h2 id="credential-setup-title">이메일 로그인을 WHICH 계정에 연결해요.</h2>
        <span>
          이메일과 WHICH 비밀번호를 설정하면 연결된 소셜 로그인과 같은 계정으로 이어집니다.
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const policyError = newPasswordPolicyError(password);
          if (policyError) {
            setError(policyError);
            return;
          }
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
        <div className={styles.passwordField}>
          <input
            aria-label="새 WHICH 비밀번호"
            aria-describedby="credential-setup-password-requirement"
            type="password"
            autoComplete="new-password"
            required
            minLength={NEW_PASSWORD_MIN_LENGTH}
            maxLength={NEW_PASSWORD_MAX_LENGTH}
            placeholder="새 비밀번호"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <small id="credential-setup-password-requirement">{NEW_PASSWORD_REQUIREMENT}</small>
        </div>
        <div className={styles.actions}>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : (
            <span />
          )}
          <button type="submit" disabled={pending}>
            {pending ? "연결 중…" : "이메일 로그인 연결"}
          </button>
        </div>
      </form>
    </section>
  );
}
