"use client";

import Link from "next/link";
import { useState } from "react";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import {
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_REQUIREMENT,
  newPasswordPolicyError,
} from "@/lib/password-policy";

import styles from "./credential-auth-experience.module.css";

async function postJson(path: string, input: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-which-csrf": "member-auth" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { message?: string };
  if (!response.ok) throw new Error(body.message || "요청을 완료하지 못했습니다.");
  return body;
}

function RecoveryShell({ children }: { children: React.ReactNode }) {
  return (
    <WhichShell
      aside={
        <WhichAsideCard eyebrow="ACCOUNT SAFETY" title="복구 링크는 짧게, 한 번만 유효해요.">
          계정 존재 여부는 공개하지 않고, 사용한 링크와 기존 세션은 안전하게 폐기합니다.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        <section className={styles.card}>{children}</section>
      </div>
    </WhichShell>
  );
}

export function VerifyEmailExperience({
  initialEmail,
  status,
  returnTo,
  deliveryState,
}: {
  initialEmail: string;
  status?: "verified" | "invalid";
  returnTo: string;
  deliveryState?: "sent" | "unavailable";
}) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "verified") {
    return (
      <RecoveryShell>
        <p className={styles.eyebrow}>EMAIL VERIFIED</p>
        <h1>이메일 확인을 마쳤어요.</h1>
        <p className={styles.description}>
          이제 이메일과 비밀번호로 안전하게 로그인할 수 있습니다.
        </p>
        <Link className={styles.primaryLink} href={returnTo}>
          계속하기
        </Link>
      </RecoveryShell>
    );
  }

  return (
    <RecoveryShell>
      <p className={styles.eyebrow}>VERIFY YOUR EMAIL</p>
      <h1>
        {status === "invalid" ? "확인 링크를 다시 받아 주세요." : "받은 편지함을 확인해 주세요."}
      </h1>
      <p className={styles.description}>
        {deliveryState === "unavailable"
          ? "첫 메일을 보내지 못했습니다. 아래에서 다시 요청해 주세요. 운영 환경에서는 발신 도메인 설정이 필요합니다."
          : "링크는 24시간 동안 한 번만 사용할 수 있습니다. 메일이 없거나 링크가 만료됐다면 아래에서 새로 요청하세요."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setMessage(null);
          void postJson("/api/auth/email-verification/request", { email })
            .then((body) => setMessage(body.message || "확인 메일을 요청했습니다."))
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
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "요청 중…" : "확인 메일 다시 받기"}
        </button>
      </form>
      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <Link className={styles.backLink} href="/login">
        로그인으로 돌아가기
      </Link>
    </RecoveryShell>
  );
}

export function ForgotPasswordExperience() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <RecoveryShell>
      <p className={styles.eyebrow}>PASSWORD RECOVERY</p>
      <h1>비밀번호를 다시 정해요.</h1>
      <p className={styles.description}>
        등록 여부와 관계없이 같은 안내를 보여드립니다. 등록된 이메일이라면 30분 동안 유효한 링크를
        보냅니다.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          void postJson("/api/auth/password-reset/request", { email })
            .then((body) => setMessage(body.message || "재설정 메일을 요청했습니다."))
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
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "요청 중…" : "재설정 링크 받기"}
        </button>
      </form>
      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <Link className={styles.backLink} href="/verify-email">
        이메일 확인 메일이 필요한가요?
      </Link>
    </RecoveryShell>
  );
}

export function ResetPasswordExperience({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <RecoveryShell>
      <p className={styles.eyebrow}>NEW PASSWORD</p>
      <h1>{complete ? "비밀번호를 바꿨어요." : "새 비밀번호를 정해 주세요."}</h1>
      {complete ? (
        <>
          <p className={styles.description}>
            기존 로그인 세션은 모두 종료했습니다. 새 비밀번호로 다시 로그인해 주세요.
          </p>
          <Link className={styles.primaryLink} href="/login">
            로그인
          </Link>
        </>
      ) : (
        <>
          <p className={styles.description}>{NEW_PASSWORD_REQUIREMENT}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const policyError = newPasswordPolicyError(password);
              if (policyError) {
                setError(policyError);
                return;
              }
              if (password !== confirmation) {
                setError("두 비밀번호가 일치하지 않습니다.");
                return;
              }
              setPending(true);
              setError(null);
              void postJson("/api/auth/password-reset/confirm", { token, password })
                .then(() => {
                  window.history.replaceState(null, "", "/reset-password?status=complete");
                  setComplete(true);
                })
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : "다시 시도해 주세요."),
                )
                .finally(() => setPending(false));
            }}
          >
            <label>
              새 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                minLength={NEW_PASSWORD_MIN_LENGTH}
                maxLength={NEW_PASSWORD_MAX_LENGTH}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                minLength={NEW_PASSWORD_MIN_LENGTH}
                maxLength={NEW_PASSWORD_MAX_LENGTH}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button type="submit" disabled={pending || token.length < 32}>
              {pending ? "변경 중…" : "비밀번호 변경"}
            </button>
          </form>
          {error ? <p className={styles.error}>{error}</p> : null}
        </>
      )}
    </RecoveryShell>
  );
}
