"use client";

import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import styles from "./which-shell.module.css";

type MemberSession = {
  member: { id: string; displayName: string; status: string };
};

type MemberNavigationState = "guest" | "loading" | "member";

type MemberNavigationContextValue = {
  loginHref: string;
  state: MemberNavigationState;
};

const MemberNavigationContext = createContext<MemberNavigationContextValue>({
  loginHref: "/login?returnTo=%2F",
  state: "guest",
});

function loginHref(returnTo: string) {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function subscribeToLocation() {
  return () => undefined;
}

function currentReturnTo() {
  return `${window.location.pathname}${window.location.search}`;
}

export function MemberNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MemberNavigationState>("guest");
  const returnTo = useSyncExternalStore(subscribeToLocation, currentReturnTo, () => "/");

  useEffect(() => {
    let active = true;

    void fetch("/api/member-session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setState("guest");
          return;
        }
        const session = (await response.json()) as MemberSession;
        setState(session.member?.id ? "member" : "guest");
      })
      .catch(() => {
        if (active) setState("guest");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <MemberNavigationContext.Provider value={{ loginHref: loginHref(returnTo), state }}>
      {children}
    </MemberNavigationContext.Provider>
  );
}

export function HeaderMemberNavigation() {
  const { loginHref: guestLoginHref, state } = useContext(MemberNavigationContext);
  const href = state === "member" ? "/me" : guestLoginHref;

  return (
    <Link
      className={styles.profileLink}
      href={href}
      aria-label={state === "member" ? "내 기록" : "로그인"}
    >
      {state === "member" ? "내 기록" : "로그인"}
    </Link>
  );
}

export function MemberNavigationLink({ active }: { active: boolean }) {
  const { loginHref: guestLoginHref, state } = useContext(MemberNavigationContext);
  const href = state === "member" ? "/me" : guestLoginHref;
  const label = state === "member" ? "내 기록" : "로그인";

  return (
    <Link className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`} href={href}>
      <span aria-hidden="true">◎</span>
      <strong>{label}</strong>
    </Link>
  );
}

export function MemberCreateLink({ className, enabled }: { className?: string; enabled: boolean }) {
  const { state } = useContext(MemberNavigationContext);

  if (!enabled || state !== "member") return null;

  return (
    <Link className={className} href="/create" aria-label="새 질문 만들기">
      <span aria-hidden="true">＋</span>
      질문 만들기
    </Link>
  );
}
