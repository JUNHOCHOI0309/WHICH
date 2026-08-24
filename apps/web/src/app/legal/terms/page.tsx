import type { Metadata } from "next";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";

import styles from "../legal.module.css";

export const metadata: Metadata = { title: "서비스 이용약관" };

export default function TermsPage() {
  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@whichone.site";
  return (
    <WhichShell
      aside={
        <WhichAsideCard eyebrow="TERMS" title="사람들의 선택을 안전하게 연결합니다.">
          투표와 의견 교환을 존중하며 조작·괴롭힘·불법 이용은 제한합니다.
        </WhichAsideCard>
      }
    >
      <article className={styles.document}>
        <p>WHICH BETA TERMS · 2026-08-24</p>
        <h1>서비스 이용약관</h1>
        <p>
          이 약관은 WHICH 프로젝트가 제공하는 질문, A/B 투표, 결과, 댓글, 계정 기능의 이용 조건을
          정합니다.
        </p>
        <h2>1. 계정과 Guest 이용</h2>
        <p>
          Guest는 허용된 범위에서 투표·댓글·반응을 이용할 수 있습니다. Member는 정확한 정보를
          사용하고 인증 수단과 비밀번호를 안전하게 관리해야 합니다. 하나의 사람은 연결한 여러 로그인
          수단을 하나의 Member로 관리할 수 있습니다.
        </p>
        <h2>2. 이용자 콘텐츠</h2>
        <p>
          작성자는 게시할 권리가 있는 내용만 올려야 합니다. WHICH는 서비스 표시·전송·보관 및 운영에
          필요한 범위에서 콘텐츠를 처리할 수 있으며, 권리는 작성자에게 유지됩니다.
        </p>
        <h2>3. 금지 행위</h2>
        <ul>
          <li>자동화·다중 계정·기술적 우회로 투표나 반응을 조작하는 행위</li>
          <li>타인을 사칭하거나 개인정보·불법·혐오·괴롭힘 콘텐츠를 게시하는 행위</li>
          <li>서비스 보안, 안정성, 다른 이용자의 정상 이용을 방해하는 행위</li>
        </ul>
        <h2>4. 운영 조치</h2>
        <p>
          신고와 위험 신호에 따라 콘텐츠를 숨기거나 검토하고, 계정을 제한·정지할 수 있습니다. 중대한
          조치에는 합리적인 이의 제기와 검토 절차를 마련합니다.
        </p>
        <h2>5. 베타 서비스</h2>
        <p>
          현재 서비스는 베타 단계로 기능이 변경되거나 일시 중단될 수 있습니다. 고의 또는 중대한
          과실이 없는 한 예측하기 어려운 간접 손해에 대한 책임은 제한됩니다.
        </p>
        <h2>6. 회원 탈퇴</h2>
        <p>
          Member는 내 기록 화면에서 회원 탈퇴를 요청할 수 있습니다. 탈퇴가 완료되면 로그인 정보와
          프로필은 삭제되고 모든 세션이 종료됩니다. 이미 작성한 질문·투표·댓글·반응은 서비스의 결과
          통계와 대화 맥락을 훼손하지 않도록 작성자 식별 정보와 분리해 “탈퇴한 사용자” 기록으로 남을
          수 있습니다. 탈퇴 처리는 되돌릴 수 없습니다.
        </p>
        <h2>7. 문의</h2>
        <p>
          약관과 서비스 운영 문의: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      </article>
    </WhichShell>
  );
}
