import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import { IssueCreatorExperience } from "@/features/issues/issue-creator-experience";

export const metadata = {
  title: "질문 만들기 | WHICH",
  description: "사람들에게 물어볼 A/B 질문을 만드세요.",
};

export default function CreateIssuePage() {
  return (
    <WhichShell
      active="create"
      aside={
        <WhichAsideCard
          eyebrow="SAFE CREATION"
          title="한 번에 하나의 선택만 선명하게 물어봐요."
          tone="orange"
        >
          사실 판단이나 정치 주제보다 누구나 가볍게 고를 수 있는 일상형 질문이 잘 어울립니다.
        </WhichAsideCard>
      }
    >
      <IssueCreatorExperience />
    </WhichShell>
  );
}
