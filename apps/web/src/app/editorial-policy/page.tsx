import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "질문 편집 원칙",
  description: "WHICH 공개 질문의 균형, 출처, 중복, 품질 검토 원칙을 설명합니다.",
  alternates: { canonical: "/editorial-policy" },
};

export default function EditorialPolicyPage() {
  return (
    <TrustDocument
      eyebrow="EDITORIAL POLICY"
      title="질문은 선택을 유도하지 않도록 다듬습니다."
      summary="WHICH는 질문과 선택지가 이해하기 쉽고 서로 비교 가능하며, 한쪽 답을 정답처럼 유도하지 않도록 검토합니다."
      asideTitle="질문 품질과 편향을 함께 살핍니다."
      aside="중복, 모호함, 과도한 선동, 출처 불명확성을 공개 전에 줄이는 것이 목표입니다."
    >
      <h2>검토 기준</h2>
      <ul>
        <li>질문과 선택지가 같은 비교 축에 놓여 있는지 확인합니다.</li>
        <li>한쪽을 비하하거나 사실상 정답을 암시하는 표현을 줄입니다.</li>
        <li>이미 공개된 질문과 지나치게 겹치지 않는지 확인합니다.</li>
        <li>사실 주장과 이미지에 출처 또는 사용 권한이 필요한지 확인합니다.</li>
      </ul>
      <h2>작성자 질문</h2>
      <p>
        Member가 만든 질문은 안전·중복·품질 기준에 따라 게시가 보류되거나 수정 요청을 받을 수
        있습니다. 공개 후에도 신고나 새로운 근거가 확인되면 다시 검토할 수 있습니다.
      </p>
    </TrustDocument>
  );
}
