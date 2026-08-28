"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";

import type { PublicIssueFeed } from "@/lib/contracts";

import {
  HeaderMemberNavigation,
  MemberNavigationLink,
  MemberQuestionComposerButton,
  MemberNavigationProvider,
} from "./member-navigation";
import { QuestionComposerProvider } from "../question-composer/question-composer";
import styles from "./which-shell.module.css";

export function WhichShell({
  children,
  active,
  aside,
  preserveAsideOnNarrow = false,
  creationEnabled = false,
}: {
  children: ReactNode;
  active?: "home" | "interests" | "create" | "me";
  aside?: ReactNode;
  preserveAsideOnNarrow?: boolean;
  creationEnabled?: boolean;
}) {
  const [mobileAsideOpen, setMobileAsideOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const gesture = useRef<{ startX: number; startY: number; lastX: number; lastY: number } | null>(
    null,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      setIsMobile(query.matches);
      if (!query.matches) setMobileAsideOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mobileAsideOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileAsideOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileAsideOpen]);

  const startAsideGesture = (event: TouchEvent<HTMLElement>) => {
    if (!preserveAsideOnNarrow || window.innerWidth > 767) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (!mobileAsideOpen && touch.clientX < window.innerWidth - 40) return;
    gesture.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
  };

  const moveAsideGesture = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!gesture.current || !touch) return;
    gesture.current.lastX = touch.clientX;
    gesture.current.lastY = touch.clientY;
  };

  const finishAsideGesture = () => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    const deltaX = current.lastX - current.startX;
    const deltaY = current.lastY - current.startY;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (!mobileAsideOpen && deltaX < 0) setMobileAsideOpen(true);
    if (mobileAsideOpen && deltaX > 0) setMobileAsideOpen(false);
  };

  return (
    <MemberNavigationProvider>
      <QuestionComposerProvider enabled={creationEnabled}>
        <main
          className={styles.page}
          onTouchStart={startAsideGesture}
          onTouchMove={moveAsideGesture}
          onTouchEnd={finishAsideGesture}
          onTouchCancel={() => {
            gesture.current = null;
          }}
        >
          <header className={styles.header}>
            <div className={styles.headerInner}>
              <Link className={styles.brand} href="/" aria-label="WHICH 홈">
                <span>W</span>HICH
              </Link>
              <p className={styles.productLine}>고르고, 결과를 확인하세요.</p>
              <HeaderMemberNavigation />
            </div>
          </header>

          <div
            className={styles.shell}
            data-preserve-aside={preserveAsideOnNarrow ? "true" : undefined}
          >
            <nav className={styles.leftRail} aria-label="주요 메뉴">
              <div className={styles.railNavigation}>
                <ShellLink href="/" active={active === "home"} icon="⌂">
                  홈
                </ShellLink>
                <ShellLink href="/interests" active={active === "interests"} icon="#">
                  관심사
                </ShellLink>
                <MemberNavigationLink active={active === "me"} />
              </div>
              <div className={styles.railNote}>
                <strong>RESULTS AFTER VOTE</strong>
                <span>내가 고른 뒤에 사람들의 선택을 확인합니다.</span>
              </div>
              {creationEnabled ? (
                <MemberQuestionComposerButton
                  className={`${styles.navLink} ${styles.questionButton}`}
                />
              ) : null}
            </nav>

            <div className={styles.main}>{children}</div>

            {preserveAsideOnNarrow ? (
              <button
                type="button"
                className={styles.mobileAsideBackdrop}
                aria-label="W Point 패널 닫기"
                data-open={mobileAsideOpen ? "true" : undefined}
                onClick={() => setMobileAsideOpen(false)}
              />
            ) : null}

            <aside
              className={styles.rightRail}
              aria-label="WHICH 안내"
              aria-hidden={preserveAsideOnNarrow && isMobile && !mobileAsideOpen ? true : undefined}
              data-mobile-open={mobileAsideOpen ? "true" : undefined}
              inert={preserveAsideOnNarrow && isMobile && !mobileAsideOpen ? true : undefined}
            >
              {preserveAsideOnNarrow ? (
                <div className={styles.mobileAsideHeader}>
                  <strong>W Point</strong>
                  <button
                    type="button"
                    aria-label="W Point 패널 닫기"
                    onClick={() => setMobileAsideOpen(false)}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <div className={styles.mobileAsideContent}>
                {aside ?? (
                  <WhichAsideCard
                    eyebrow="WHICH PRINCIPLE"
                    title="먼저 선택하고, 그다음 결과를 봐요."
                  >
                    어느 한쪽도 미리 추천하지 않습니다.
                  </WhichAsideCard>
                )}
              </div>
            </aside>

            {preserveAsideOnNarrow ? (
              <button
                type="button"
                className={styles.mobileAsideTrigger}
                aria-label="W Point 내역 열기"
                aria-expanded={mobileAsideOpen}
                onClick={() => setMobileAsideOpen(true)}
              >
                <strong>W</strong>
                <span>POINT</span>
              </button>
            ) : null}
          </div>

          <footer className={styles.footer}>
            <span>WHICH · 2026</span>
            <Link href="/about">서비스 소개</Link>
            <Link href="/methodology">결과 산정 원칙</Link>
            <Link href="/moderation-policy">운영 정책</Link>
            <Link href="/legal/terms">서비스 이용약관</Link>
            <Link href="/legal/privacy">개인정보 처리방침</Link>
          </footer>

          <nav className={styles.bottomNav} aria-label="모바일 주요 메뉴">
            <ShellLink href="/" active={active === "home"} icon="⌂">
              홈
            </ShellLink>
            <ShellLink href="/interests" active={active === "interests"} icon="#">
              관심사
            </ShellLink>
            <MemberQuestionComposerButton
              className={`${styles.navLink} ${styles.mobileQuestionButton}`}
              mobile
            />
            <MemberNavigationLink active={active === "me"} />
          </nav>
        </main>
      </QuestionComposerProvider>
    </MemberNavigationProvider>
  );
}

export function WhichAsideCard({
  eyebrow,
  title,
  children,
  tone = "cyan",
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  tone?: "cyan" | "orange";
}) {
  return (
    <div className={styles.principleCard} data-tone={tone}>
      <span>{eyebrow}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function WhichParticipationAside({
  rail,
}: {
  rail: NonNullable<PublicIssueFeed["rightRail"]>;
}) {
  return (
    <section className={styles.participationCard} aria-labelledby="participation-rail-title">
      <header>
        <span>NOW ON WHICH</span>
        <strong id="participation-rail-title">지금 많이 참여하는 질문</strong>
        <p>최근 24시간의 정상 참여를 기준으로 보여드려요.</p>
      </header>
      <ol>
        {rail.items.map((item, index) => (
          <li key={item.issueId}>
            <Link href={`/issues/${item.issueId}`}>
              <span className={styles.participationRank}>{index + 1}</span>
              <span className={styles.participationContent}>
                <span className={styles.participationMeta}>
                  {item.categoryCode.replaceAll("_", " ")}
                  <span aria-hidden="true">·</span>
                  {item.reasonCode === "RECENT_PARTICIPATION"
                    ? `${item.participationCount.toLocaleString("ko-KR")}명 참여`
                    : "새 질문"}
                </span>
                <strong>{item.question}</strong>
              </span>
              <span className={styles.participationArrow} aria-hidden="true">
                ↗
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <footer>결과는 선택 후 공개됩니다.</footer>
    </section>
  );
}

function ShellLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: string;
  children: ReactNode;
}) {
  return (
    <Link className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`} href={href}>
      <span aria-hidden="true">{icon}</span>
      <strong>{children}</strong>
    </Link>
  );
}
