import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "투표 무결성",
  description: "WHICH가 중복 투표, 조작 신호, 결과 잠금과 정정을 다루는 원칙을 설명합니다.",
  alternates: { canonical: "/vote-integrity" },
};

export default function VoteIntegrityPage() {
  return (
    <TrustDocument
      eyebrow="VOTE INTEGRITY"
      title="한 사람의 선택이 과도하게 반복되지 않도록 보호합니다."
      summary="Guest와 Member의 선택을 일관된 주체 기록으로 연결하고, 중복·비정상 패턴과 운영 조치를 결과 상태에 반영합니다."
      asideTitle="총계보다 유효한 선택을 우선합니다."
      aside="비정상 선택을 제외하거나 결과를 잠그면 표시 값이 이후 조정될 수 있습니다."
    >
      <h2>중복 선택 방지</h2>
      <p>
        같은 주체가 같은 질문에 반복 요청을 보내더라도 하나의 유효 선택으로 처리합니다. 로그인 전후
        기록을 연결할 때에도 이미 존재하는 선택을 새 표처럼 더하지 않습니다.
      </p>
      <h2>결과 상태</h2>
      <p>
        정상, 모니터링, 검토 중, 결과 잠금, 정정 등의 상태를 운영할 수 있습니다. 신뢰하기 어려운
        상황에서는 비율을 숨기거나 기존 결과가 변할 수 있음을 알립니다.
      </p>
      <h2>자동화의 역할</h2>
      <p>
        자동 신호는 검토 우선순위를 정하는 보조 수단입니다. 중대한 제재나 영구 조치는 근거와 이력,
        이의 제기 가능성을 함께 고려합니다.
      </p>
    </TrustDocument>
  );
}
