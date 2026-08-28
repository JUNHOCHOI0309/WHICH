import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "WHICH 소개",
  description: "먼저 선택한 뒤 결과와 이유를 확인하는 WHICH의 목적과 공개 원칙을 소개합니다.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <TrustDocument
      eyebrow="ABOUT WHICH"
      title="선택을 통해 서로의 생각을 발견합니다."
      summary="WHICH는 일상의 고민과 사회적 질문에 먼저 답한 뒤, 다른 사람들의 선택과 이유를 확인하는 참여형 서비스입니다."
      asideTitle="먼저 고르고, 결과는 그다음에 봅니다."
      aside="선택 전 여론을 숨겨 앞선 결과가 내 판단에 주는 영향을 줄입니다."
    >
      <h2>무엇을 제공하나요?</h2>
      <p>
        공개 질문, 선택지, 질문 맥락을 누구나 읽을 수 있습니다. 투표 결과와 댓글은 직접 선택한 뒤
        열리며, 작성자의 개인 선택 기록은 공개 프로필과 분리합니다.
      </p>
      <h2>어떻게 해석해야 하나요?</h2>
      <p>
        WHICH 결과는 자발적으로 참여한 이용자의 현재 선택을 보여주는 서비스 내 스냅샷입니다. 전체
        인구를 대표하는 조사나 과학적 여론조사로 해석해서는 안 됩니다.
      </p>
      <h2>문의</h2>
      <p>
        서비스와 공개 정보에 관한 문의는{" "}
        <a href="mailto:support@whichone.site">support@whichone.site</a>로 보내 주세요.
      </p>
    </TrustDocument>
  );
}
