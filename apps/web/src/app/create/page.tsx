import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import { IssueCreatorExperience } from "@/features/issues/issue-creator-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata = privatePageMetadata(
  "질문 만들기",
  "사람들에게 물어볼 A/B 질문을 만드세요.",
);

export default async function CreateIssuePage() {
  const enabled = await creatorSubmissionsEnabled();
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
      {enabled ? (
        <IssueCreatorExperience />
      ) : (
        <section>
          <h1>질문 만들기를 잠시 쉬고 있어요.</h1>
          <p>
            안전 점검이 끝나면 다시 열겠습니다. 기존 질문의 투표와 결과는 그대로 이용할 수 있어요.
          </p>
        </section>
      )}
    </WhichShell>
  );
}
