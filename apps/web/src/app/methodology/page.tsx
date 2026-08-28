import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "결과 산정 원칙",
  description: "WHICH 투표 결과의 집계 방식, 한계, 수정 가능성을 설명합니다.",
  alternates: { canonical: "/methodology" },
};

export default function MethodologyPage() {
  return (
    <TrustDocument
      eyebrow="METHODOLOGY"
      title="WHICH 결과는 이렇게 읽어야 합니다."
      summary="표시되는 비율은 해당 질문에 기록된 유효 선택을 기준으로 계산하며, 운영 검토에 따라 정정될 수 있습니다."
      asideTitle="서비스 참여 결과이지 대표 표본 조사는 아닙니다."
      aside="참여자는 무작위 추출되지 않으며 인구통계 가중치도 적용하지 않습니다."
    >
      <h2>선택 전 결과 비공개</h2>
      <p>
        이용자가 A 또는 B를 고르기 전에는 기존 비율을 보여주지 않습니다. 질문 문장과 맥락, 선택지만
        공개하며 결과 수치와 댓글은 일반 검색 설명에도 넣지 않습니다.
      </p>
      <h2>집계 단위</h2>
      <p>
        하나의 질문에서 같은 Guest 또는 Member의 중복 선택은 한 번만 유효하게 처리합니다. 무효화,
        검토, 잠금 상태가 반영되면 표시 총계와 비율이 달라질 수 있습니다.
      </p>
      <h2>한계</h2>
      <ul>
        <li>WHICH 이용자가 자발적으로 참여한 결과입니다.</li>
        <li>연령·지역·성별 등 인구통계 가중치를 적용하지 않습니다.</li>
        <li>질문 문구, 노출 위치, 참여 시점에 따라 결과가 달라질 수 있습니다.</li>
        <li>현재 비율은 계속 변할 수 있는 스냅샷입니다.</li>
      </ul>
    </TrustDocument>
  );
}
