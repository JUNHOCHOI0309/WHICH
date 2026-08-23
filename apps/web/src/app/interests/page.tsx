import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import { InterestSelector } from "@/features/interests/interest-selector";

import styles from "./page.module.css";

export const metadata = {
  title: "관심 주제 설정 | WHICH",
  description: "관심 주제를 고르고 추천 설정을 관리합니다.",
};

export default function InterestsPage() {
  return (
    <WhichShell
      active="interests"
      aside={
        <WhichAsideCard
          eyebrow="PRIVATE SIGNALS"
          title="선택 방향은 관심사로 저장하지 않아요."
          tone="orange"
        >
          어떤 주제에 관심 있는지만 추천 순서에 반영합니다.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        <header className={styles.intro}>
          <p>PERSONALIZATION</p>
          <h1>보고 싶은 질문의 범위를 정해요.</h1>
          <span>최소 3개를 고르면 다음 피드부터 관심 주제를 먼저 보여드립니다.</span>
        </header>
        <InterestSelector mode="settings" />
      </div>
    </WhichShell>
  );
}
