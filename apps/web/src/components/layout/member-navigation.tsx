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
import { useQuestionComposer } from "../question-composer/question-composer";

type MemberSession = {
  member: {
    id: string;
    displayName: string;
    status: string;
    avatar: { kind: "INITIALS"; initials: string } | { kind: "IMAGE"; url: string };
  };
};

type MemberNavigationState = "guest" | "loading" | "member";

type MemberNavigationContextValue = {
  loginHref: string;
  member: MemberSession["member"] | null;
  state: MemberNavigationState;
};

const MemberNavigationContext = createContext<MemberNavigationContextValue>({
  loginHref: "/login?returnTo=%2F",
  member: null,
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

function fallbackInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return (
    (words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      : words[0]?.slice(0, 2)) || "W"
  );
}

export function MemberNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MemberNavigationState>("guest");
  const [member, setMember] = useState<MemberSession["member"] | null>(null);
  const returnTo = useSyncExternalStore(subscribeToLocation, currentReturnTo, () => "/");

  useEffect(() => {
    let active = true;

    void fetch("/api/member-session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setMember(null);
          setState("guest");
          return;
        }
        const session = (await response.json()) as MemberSession;
        setMember(session.member?.id ? session.member : null);
        setState(session.member?.id ? "member" : "guest");
      })
      .catch(() => {
        if (active) {
          setMember(null);
          setState("guest");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <MemberNavigationContext.Provider value={{ loginHref: loginHref(returnTo), member, state }}>
      {children}
    </MemberNavigationContext.Provider>
  );
}

export function HeaderMemberNavigation() {
  const { loginHref: guestLoginHref, member, state } = useContext(MemberNavigationContext);
  const href = state === "member" ? "/me" : guestLoginHref;
  const avatar =
    member?.avatar ??
    (member ? { kind: "INITIALS" as const, initials: fallbackInitials(member.displayName) } : null);

  return (
    <Link
      className={`${styles.profileLink} ${state === "member" ? styles.profileLinkMember : ""}`}
      href={href}
      aria-label={state === "member" ? "내 기록" : "로그인"}
      title={state === "member" ? member?.displayName : undefined}
    >
      {state === "member" && member && avatar ? (
        avatar.kind === "IMAGE" ? (
          <img
            className={styles.profileAvatar}
            src={avatar.url}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.profileAvatarFallback} aria-hidden="true">
            {avatar.initials}
          </span>
        )
      ) : (
        "로그인"
      )}
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

export function MemberQuestionComposerButton({
  className,
  mobile = false,
}: {
  className?: string;
  mobile?: boolean;
}) {
  const { state } = useContext(MemberNavigationContext);
  const { isOpen, openComposer } = useQuestionComposer();

  if (state !== "member") return null;

  return (
    <button
      className={className}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls="question-composer-dialog"
      onClick={openComposer}
    >
      {mobile ? <span aria-hidden="true">?</span> : null}
      <strong>{mobile ? "질문" : "Question"}</strong>
    </button>
  );
}
