import Link from "next/link";
import type { ReactNode } from "react";

import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

import {
  HeaderMemberNavigation,
  MemberNavigationLink,
  MemberNavigationProvider,
} from "./member-navigation";
import styles from "./which-shell.module.css";

export function WhichShell({
  children,
  active,
  aside,
}: {
  children: ReactNode;
  active?: "home" | "interests" | "create" | "me";
  aside?: ReactNode;
}) {
  const creationEnabled = creatorSubmissionsEnabled();
  return (
    <MemberNavigationProvider>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link className={styles.brand} href="/" aria-label="WHICH 홈">
              <span>W</span>HICH
            </Link>
            <p className={styles.productLine}>고르고, 결과를 확인하세요.</p>
            <HeaderMemberNavigation />
          </div>
        </header>

        <div className={styles.shell}>
          <nav className={styles.leftRail} aria-label="주요 메뉴">
            <ShellLink href="/" active={active === "home"} icon="⌂">
              홈
            </ShellLink>
            <ShellLink href="/interests" active={active === "interests"} icon="#">
              관심사
            </ShellLink>
            {creationEnabled ? (
              <ShellLink href="/create" active={active === "create"} icon="＋">
                질문 만들기
              </ShellLink>
            ) : null}
            <MemberNavigationLink active={active === "me"} />
            <div className={styles.railNote}>
              <strong>RESULTS AFTER VOTE</strong>
              <span>내가 고른 뒤에 사람들의 선택을 확인합니다.</span>
            </div>
          </nav>

          <div className={styles.main}>{children}</div>

          <aside className={styles.rightRail} aria-label="WHICH 안내">
            {aside ?? (
              <WhichAsideCard eyebrow="WHICH PRINCIPLE" title="먼저 선택하고, 그다음 결과를 봐요.">
                어느 한쪽도 미리 추천하지 않습니다.
              </WhichAsideCard>
            )}
          </aside>
        </div>

        <footer className={styles.footer}>
          <span>WHICH · 2026</span>
          <Link href="/legal/terms">서비스 이용약관</Link>
          <Link href="/legal/privacy">개인정보 처리방침</Link>
        </footer>

        <nav
          className={`${styles.bottomNav} ${creationEnabled ? styles.bottomNavFour : ""}`}
          aria-label="모바일 주요 메뉴"
        >
          <ShellLink href="/" active={active === "home"} icon="⌂">
            홈
          </ShellLink>
          <ShellLink href="/interests" active={active === "interests"} icon="#">
            관심사
          </ShellLink>
          {creationEnabled ? (
            <ShellLink href="/create" active={active === "create"} icon="＋">
              만들기
            </ShellLink>
          ) : null}
          <MemberNavigationLink active={active === "me"} />
        </nav>
      </main>
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
