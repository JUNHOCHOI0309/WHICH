import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "정정 및 권리 요청",
  description: "WHICH 공개 질문과 이미지의 오류, 개인정보, 명예훼손, 저작권 정정 요청 절차입니다.",
  alternates: { canonical: "/corrections" },
};

export default function CorrectionsPage() {
  return (
    <TrustDocument
      eyebrow="CORRECTIONS"
      title="오류와 권리 침해 요청을 기록하고 바로잡습니다."
      summary="사실 오류, 개인정보, 명예훼손, 저작권 또는 이미지 사용 권한 문제가 있으면 대상과 근거를 확인해 조치합니다."
      asideTitle="수정과 삭제 판단은 이력과 근거를 남깁니다."
      aside="결과에 영향을 주는 정정은 가능한 범위에서 이용자에게 상태 변화를 알립니다."
    >
      <h2>요청 방법</h2>
      <p>
        대상 질문·댓글·이미지 주소, 요청 유형, 문제가 되는 부분, 확인 가능한 근거를 포함해{" "}
        <a href="mailto:support@whichone.site">support@whichone.site</a>로 보내 주세요. 개인정보는
        필요한 범위만 전달해 주세요.
      </p>
      <h2>처리 원칙</h2>
      <ul>
        <li>대상과 요청자의 관련성을 확인합니다.</li>
        <li>긴급한 개인정보·안전 위험은 우선 노출을 제한할 수 있습니다.</li>
        <li>수정, 블라인드, 삭제, 유지 판단과 근거를 운영 이력에 남깁니다.</li>
        <li>투표 결과에 영향을 주는 변경은 무결성 상태와 함께 검토합니다.</li>
      </ul>
    </TrustDocument>
  );
}
