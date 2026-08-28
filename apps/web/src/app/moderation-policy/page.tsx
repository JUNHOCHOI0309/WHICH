import type { Metadata } from "next";

import { TrustDocument } from "@/components/search/trust-document";

export const metadata: Metadata = {
  title: "커뮤니티 운영 정책",
  description: "WHICH의 신고, 숨김, 제재, 자동 보조 검토와 이의 제기 원칙을 안내합니다.",
  alternates: { canonical: "/moderation-policy" },
};

export default function ModerationPolicyPage() {
  return (
    <TrustDocument
      eyebrow="MODERATION POLICY"
      title="열린 대화와 안전을 함께 지킵니다."
      summary="WHICH는 의견 차이를 허용하지만 괴롭힘, 혐오, 개인정보 노출, 스팸, 조작과 불법 콘텐츠는 제한합니다."
      asideTitle="신고는 검토 신호이며 곧바로 유죄 판단은 아닙니다."
      aside="누적 신호로 노출을 일시 제한할 수 있으며, 중대한 조치는 운영 검토와 이력을 남깁니다."
    >
      <h2>신고와 임시 조치</h2>
      <p>
        이용자는 댓글과 콘텐츠를 신고할 수 있습니다. 위험 신호가 누적되면 확산을 줄이기 위해 임시로
        숨기고 운영 검토 대상으로 보낼 수 있습니다.
      </p>
      <h2>자동화와 AI 보조</h2>
      <p>
        자동 분류와 AI는 우선순위 지정, 중복 탐지, 위험 요약을 돕는 보조 수단입니다. 고위험 판단,
        계정 제재, 이의 제기는 사람이 확인할 수 있는 절차를 목표로 합니다.
      </p>
      <h2>문의와 이의 제기</h2>
      <p>
        운영 조치나 권리 침해와 관련된 문의는{" "}
        <a href="mailto:support@whichone.site">support@whichone.site</a>로 근거와 대상 주소를 보내
        주세요.
      </p>
    </TrustDocument>
  );
}
