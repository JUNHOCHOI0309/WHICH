import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./which-shell.module.css";

export function WhichShell({
  children,
  active = "home",
  aside,
}: {
  children: ReactNode;
  active?: "home" | "interests" | "me";
  aside?: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="WHICH 홈">
            <span>W</span>HICH
          </Link>
          <p className={styles.productLine}>고르고, 결과를 확인하세요.</p>
          <Link className={styles.profileLink} href="/me">
            내 기록
          </Link>
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
          <ShellLink href="/me" active={active === "me"} icon="◎">
            내 기록
          </ShellLink>
          <div className={styles.railNote}>
            <strong>RESULTS AFTER VOTE</strong>
            <span>내가 고른 뒤에 사람들의 선택을 확인합니다.</span>
          </div>
        </nav>

        <div className={styles.main}>{children}</div>

        <aside className={styles.rightRail} aria-label="WHICH 안내">
          {aside ?? (
            <div className={styles.principleCard}>
              <span>WHICH PRINCIPLE</span>
              <strong>먼저 선택하고, 그다음 결과를 봐요.</strong>
              <p>어느 한쪽도 미리 추천하지 않습니다.</p>
            </div>
          )}
        </aside>
      </div>

      <nav className={styles.bottomNav} aria-label="모바일 주요 메뉴">
        <ShellLink href="/" active={active === "home"} icon="⌂">
          홈
        </ShellLink>
        <ShellLink href="/interests" active={active === "interests"} icon="#">
          관심사
        </ShellLink>
        <ShellLink href="/me" active={active === "me"} icon="◎">
          내 기록
        </ShellLink>
      </nav>
    </main>
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
