import type { Metadata } from "next";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";

import styles from "../legal.module.css";

export const metadata: Metadata = { title: "개인정보 처리방침" };

export default function PrivacyPolicyPage() {
  const supportEmail = process.env.SUPPORT_EMAIL ?? "privacy@whichone.site";
  return (
    <WhichShell
      aside={
        <WhichAsideCard eyebrow="PRIVACY" title="선택 기록은 공개 프로필과 분리합니다.">
          필요한 정보만 수집하고 계정 복구와 서비스 운영에 한정해 사용합니다.
        </WhichAsideCard>
      }
    >
      <article className={styles.document}>
        <p>WHICH BETA POLICY · 2026-08-24</p>
        <h1>개인정보 처리방침</h1>
        <p>
          WHICH 프로젝트는 회원 인증, 투표 무결성, 서비스 개선에 필요한 범위에서 개인정보를
          처리합니다.
        </p>
        <h2>1. 처리하는 정보</h2>
        <ul>
          <li>계정: 이메일, 비밀번호 해시, 이메일 확인 시각, 연결한 소셜 서비스 식별자</li>
          <li>이용: 투표·댓글·반응·신고 기록, Guest 및 Member 식별자, 접속·오류·보안 로그</li>
          <li>선택 입력: Handle, 소개, 관심사</li>
        </ul>
        <h2>2. 이용 목적</h2>
        <p>
          로그인과 계정 복구, 중복 투표 방지, 선택 기록 제공, 댓글 운영, 보안·장애 대응, 서비스 품질
          개선에 사용합니다.
        </p>
        <h2>3. 보관과 파기</h2>
        <p>
          계정 정보는 탈퇴 또는 처리 목적 종료 시까지 보관합니다. 법령상 보존 의무가 있거나
          분쟁·부정 이용 대응이 필요한 기록은 필요한 기간만 분리 보관한 뒤 파기합니다. 검증·재설정
          토큰은 해시로 저장하며 만료 또는 사용 시 무효화됩니다.
        </p>
        <h2>4. 처리 위탁 및 국외 처리</h2>
        <p>
          서비스 운영을 위해 Render(호스팅·데이터베이스), Resend(인증 이메일), 사용자가 선택한
          Google·X·네이버·카카오(소셜 인증)를 이용할 수 있습니다. 각 서비스에는 해당 기능 수행에
          필요한 정보만 전달됩니다.
        </p>
        <h2>5. 쿠키와 보호조치</h2>
        <p>
          로그인 세션과 Guest 기록 연결을 위해 HttpOnly·Secure·SameSite 쿠키를 사용합니다.
          비밀번호는 Argon2id로, 일회용 토큰과 세션 토큰은 원문이 아닌 해시로 저장합니다.
        </p>
        <h2>6. 이용자 권리와 문의</h2>
        <p>
          본인 정보의 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 문의:{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      </article>
    </WhichShell>
  );
}
