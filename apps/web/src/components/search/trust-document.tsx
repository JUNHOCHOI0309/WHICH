import Link from "next/link";
import type { ReactNode } from "react";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";

import styles from "@/app/legal/legal.module.css";

export function TrustDocument({
  eyebrow,
  title,
  summary,
  asideTitle,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  asideTitle: string;
  aside: string;
  children: ReactNode;
}) {
  return (
    <WhichShell
      active="home"
      aside={
        <WhichAsideCard eyebrow="TRUST & TRANSPARENCY" title={asideTitle}>
          {aside}
        </WhichAsideCard>
      }
    >
      <article className={styles.document}>
        <p>{eyebrow} · UPDATED 2026-08-29</p>
        <h1>{title}</h1>
        <p>{summary}</p>
        {children}
        <h2>관련 문서</h2>
        <p>
          <Link href="/about">서비스 소개</Link> · <Link href="/methodology">결과 산정 원칙</Link> ·{" "}
          <Link href="/editorial-policy">편집 원칙</Link> ·{" "}
          <Link href="/vote-integrity">투표 무결성</Link> ·{" "}
          <Link href="/moderation-policy">운영 정책</Link> ·{" "}
          <Link href="/corrections">정정 안내</Link>
        </p>
      </article>
    </WhichShell>
  );
}
