"use client";

import { useEffect, useMemo, useState } from "react";

import { loginHref } from "@/lib/auth";

import styles from "./member-access.module.css";

type Session = {
  member: { id: string; displayName: string; status: string };
  expiresAt: string;
};

export function MemberAccess({ issueId }: { issueId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "member" | "error">("loading");
  const [authOutcome] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("auth"),
  );

  useEffect(() => {
    void fetch("/api/member-session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setState("guest");
          return;
        }
        if (!response.ok) throw new Error("Session read failed");
        setSession((await response.json()) as Session);
        setState("member");
      })
      .catch(() => setState("error"));
  }, []);

  const loginHrefs = useMemo(() => {
    const returnTo = `/issues/${issueId}#member-access`;
    return {
      google: loginHref("google", returnTo),
      x: loginHref("x", returnTo),
    };
  }, [issueId]);

  return (
    <section className={styles.access} id="member-access" aria-live="polite">
      <div>
        <p className={styles.eyebrow}>MEMBER LINK</p>
        <h2>
          {state === "member"
            ? `${session?.member.displayName}님으로 연결됨`
            : "이 선택을 계정에 이어 두세요"}
        </h2>
        <p>
          {state === "member"
            ? "현재 Guest 선택 기록이 이 계정과 연결되어 있습니다. 원래 투표 기록은 감사 가능하게 유지됩니다."
            : "Google 또는 X 로그인 후에도 이 질문과 결과 화면으로 돌아오며, Guest 선택은 중복 집계 없이 계정에 연결됩니다."}
        </p>
      </div>

      {state === "loading" ? <span className={styles.status}>로그인 상태 확인 중…</span> : null}
      {state === "guest" || state === "error" ? (
        <div className={styles.loginOptions} aria-label="로그인 제공자 선택">
          <a className={styles.login} href={loginHrefs.google}>
            Google로 이어서 로그인
            <span aria-hidden="true">→</span>
          </a>
          <a className={`${styles.login} ${styles.xLogin}`} href={loginHrefs.x}>
            X로 이어서 로그인
            <span aria-hidden="true">→</span>
          </a>
        </div>
      ) : null}
      {state === "member" ? (
        <button
          className={styles.logout}
          type="button"
          onClick={() => {
            setState("loading");
            void fetch("/api/member-session", { method: "DELETE" })
              .then(() => {
                setSession(null);
                setState("guest");
              })
              .catch(() => setState("error"));
          }}
        >
          로그아웃
        </button>
      ) : null}

      {authOutcome === "cancelled" ? (
        <p className={styles.notice}>
          로그인을 취소했어요. 질문과 선택 결과는 그대로 유지했습니다.
        </p>
      ) : null}
      {authOutcome === "error" ? (
        <p className={styles.notice}>
          로그인을 마치지 못했어요. 현재 화면은 유지했으니 다시 시도할 수 있어요.
        </p>
      ) : null}
      {authOutcome === "unavailable" ? (
        <p className={styles.notice}>선택한 로그인 제공자의 환경 변수가 아직 설정되지 않았어요.</p>
      ) : null}
    </section>
  );
}
