"use client";

import Link from "next/link";
import Image from "next/image";
import {
  useCallback,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { MemberNotificationCenter } from "@/lib/contracts";

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

  useEffect(() => {
    const updateAvatar = (event: Event) => {
      const avatar = (event as CustomEvent<{ avatar?: MemberSession["member"]["avatar"] }>).detail
        ?.avatar;
      if (!avatar) return;
      setMember((current) => (current ? { ...current, avatar } : current));
    };
    window.addEventListener("which:member-avatar-updated", updateAvatar);
    return () => window.removeEventListener("which:member-avatar-updated", updateAvatar);
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

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
  if (absolute < 60) return formatter.format(seconds, "second");
  if (absolute < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  if (absolute < 604_800) return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

async function readNotificationCenter() {
  const response = await fetch("/api/me/notifications", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("notifications unavailable");
  return (await response.json()) as MemberNotificationCenter;
}

export function HeaderMemberNotifications() {
  const { member, state } = useContext(MemberNavigationContext);
  const [open, setOpen] = useState(false);
  const [center, setCenter] = useState<MemberNotificationCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await readNotificationCenter();
      setCenter(next);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const noticeIds = center?.items.map((notice) => notice.id) ?? [];
    if (!noticeIds.length || markingAllRead) return;
    setMarkingAllRead(true);
    setError(false);
    try {
      const response = await fetch("/api/me/notifications", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noticeIds }),
      });
      if (!response.ok) throw new Error("notifications unavailable");
      setCenter((current) =>
        current
          ? {
              ...current,
              generatedAt: new Date().toISOString(),
              unreadCount: 0,
              items: [],
            }
          : current,
      );
    } catch {
      setError(true);
    } finally {
      setMarkingAllRead(false);
    }
  }, [center?.items, markingAllRead]);

  useEffect(() => {
    if (state !== "member") return;
    let active = true;
    void (async () => {
      try {
        const next = await readNotificationCenter();
        if (!active) return;
        setCenter(next);
        setError(false);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [state, member?.id]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (state !== "member" || !member) return null;

  const unreadCount = center?.unreadCount ?? 0;
  return (
    <div className={styles.notificationRoot} ref={root}>
      <button
        type="button"
        className={styles.notificationButton}
        aria-label={unreadCount ? `알림 ${unreadCount}개` : "알림"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="member-notification-panel"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) void load();
        }}
      >
        <Image src="/icons/bell.png" alt="" aria-hidden="true" width={21} height={21} />
        {unreadCount ? (
          <span className={styles.notificationBadge} aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          className={styles.notificationPanel}
          id="member-notification-panel"
          role="dialog"
          aria-label="알림"
        >
          <header>
            <div>
              <strong>알림</strong>
            </div>
            <button
              type="button"
              disabled={loading || markingAllRead || !center?.items.length}
              onClick={() => void markAllRead()}
            >
              {markingAllRead ? "처리 중..." : "모두 읽기"}
            </button>
          </header>
          <div className={styles.notificationList} aria-live="polite">
            {loading && !center ? <p className={styles.notificationState}>불러오는 중...</p> : null}
            {error ? (
              <div className={styles.notificationState} role="alert">
                <p>알림을 불러오지 못했어요.</p>
                <button type="button" onClick={() => void load()}>
                  다시 시도
                </button>
              </div>
            ) : null}
            {!loading && !error && center?.items.length === 0 ? (
              <p className={styles.notificationState}>새 알림이 없습니다.</p>
            ) : null}
            {!error
              ? center?.items.map((notice) => (
                  <article
                    className={styles.notificationItem}
                    data-unread={!notice.readAt ? "true" : undefined}
                    key={notice.id}
                  >
                    <div>
                      <strong>{notice.summary}</strong>
                      <time dateTime={notice.effectiveAt}>{relativeTime(notice.effectiveAt)}</time>
                    </div>
                    <p>{notice.nextStep}</p>
                  </article>
                ))
              : null}
          </div>
        </section>
      ) : null}
    </div>
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

  const shouldOpenFromHome =
    mobile && typeof window !== "undefined" && !["/", "/me"].includes(window.location.pathname);

  if (shouldOpenFromHome) {
    return (
      <Link className={className} href="/?compose=question" aria-label="질문">
        <span aria-hidden="true">?</span>
        <strong>질문</strong>
      </Link>
    );
  }

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
