import Link from "next/link";

import { InterestSelector } from "@/features/interests/interest-selector";

import styles from "./page.module.css";

export const metadata = {
  title: "관심 주제 설정 | WHICH",
  description: "관심 주제를 고르고 추천 설정을 관리합니다.",
};

export default function InterestsPage() {
  return (
    <main className={styles.page}>
      <header>
        <Link href="/">WHICH.</Link>
        <span>PERSONALIZATION</span>
      </header>
      <div className={styles.stage}>
        <InterestSelector mode="settings" />
      </div>
    </main>
  );
}
