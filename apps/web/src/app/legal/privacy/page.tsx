import type { Metadata } from "next";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";

import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "WHICH가 계정, 투표, 댓글과 서비스 운영 정보를 처리하는 범위를 설명합니다.",
  alternates: { canonical: "/legal/privacy" },
};

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
        <p>WHICH BETA POLICY · 2026-08-30</p>
        <h1>개인정보 처리방침</h1>
        <p>
          WHICH 프로젝트는 회원 인증, 투표 무결성, 서비스 개선에 필요한 범위에서 개인정보를
          처리합니다.
        </p>
        <h2>1. 처리하는 정보</h2>
        <ul>
          <li>계정: 이메일, 비밀번호 해시, 이메일 확인 시각, 연결한 소셜 서비스 식별자</li>
          <li>이용: 투표·댓글·반응·신고 기록, Guest 및 Member 식별자, 접속·오류·보안 로그</li>
          <li>
            선택 입력: Handle, 소개, 관심사, 직접 등록하거나 소셜 서비스에서 받은 프로필 이미지
          </li>
          <li>
            TikTok 로그인 선택·동의 시: 앱 내 계정 식별자(open_id), 표시 이름(display_name), 프로필
            이미지 주소(avatar_url)와 해당 이미지
          </li>
        </ul>
        <p>
          TikTok 로그인은 기본 프로필 권한(user.info.basic)만 요청합니다. TikTok의 이메일·비밀번호,
          영상 목록·팔로워 통계는 요청하지 않으며 영상 게시 권한도 요청하지 않습니다. WHICH 가입에
          필요한 이메일과 비밀번호는 이용자가 WHICH에 직접 입력하며 TikTok에서 제공받지 않습니다.
        </p>
        <h2>2. 이용 목적</h2>
        <p>
          로그인과 계정 복구, 중복 투표 방지, 선택 기록 제공, 댓글 운영, 보안·장애 대응, 서비스 품질
          개선에 사용합니다.
        </p>
        <p>
          TikTok에서 받은 정보는 로그인할 회원의 식별, 이용자가 요청한 계정 연결과 기본 프로필
          이름·이미지 제공에 사용합니다. 새 WHICH 계정은 추가 가입 절차를 완료해야 생성되며,
          이메일이 같다는 이유로 기존 계정과 자동 병합하지 않습니다.
        </p>
        <h2>3. 보관과 파기</h2>
        <p>
          회원 탈퇴 시 이메일, 비밀번호 해시, 이메일 확인 정보, 연결한 소셜 로그인 식별자, 공개
          프로필·프로필 이미지와 관심사를 삭제하고 모든 로그인 세션을 무효화합니다. 작성한
          질문·투표·댓글·반응은 결과 통계와 대화 맥락을 유지하기 위해 계정과 분리하여 “탈퇴한
          사용자” 기록으로 익명 보관합니다. 법령상 보존 의무가 있거나 분쟁·부정 이용 대응이 필요한
          기록은 필요한 기간만 분리 보관한 뒤 파기합니다. 검증·재설정 토큰은 해시로 저장하며 만료
          또는 사용 시 무효화됩니다. 서비스 백업에 남은 정보는 백업 보존 주기에 따라 순차적으로
          삭제됩니다.
        </p>
        <p>
          TikTok에서 받은 계정 식별자와 프로필 정보에도 위 보관·파기 기준을 적용합니다. TikTok 인증
          후 추가 가입 또는 기존 계정 재인증이 필요한 경우에는 해당 정보와 화면 복귀 경로 등을
          암호화한 임시 가입 쿠키를 사용하며, 유효기간은 최대 10분입니다. 가입·연결 완료 시 이
          쿠키를 삭제하고, 만료된 쿠키는 가입·연결에 사용하지 않습니다.
        </p>
        <p>
          TikTok 액세스 토큰은 인증과 기본 프로필 확인을 위해 서버에서 일시적으로 사용합니다. TikTok
          액세스·갱신 토큰은 데이터베이스나 브라우저 쿠키에 저장하지 않습니다.
        </p>
        <h2>4. 처리 위탁 및 국외 처리</h2>
        <p>
          서비스 운영을 위해 Render(호스팅·데이터베이스), Cloudflare R2(변환된 프로필 이미지 저장),
          Resend(인증 이메일), 사용자가 선택한 Google·X·네이버·카카오·TikTok(소셜 인증)를 이용할 수
          있습니다. 각 서비스에는 해당 기능 수행에 필요한 정보만 전달됩니다. 직접 등록한 JPG·PNG
          원본은 서버에서 512px WebP로 변환한 뒤 저장하지 않습니다.
        </p>
        <p>
          TikTok 로그인을 선택하면 인증 코드 교환과 기본 프로필 조회를 위해 TikTok 서버와 HTTPS로
          통신합니다. 이 로그인 API에 WHICH의 이메일·비밀번호, 투표·댓글·포인트 기록은 전달하지
          않습니다. 프로필 이미지는 제공된 주소에서 내려받아 기존 이미지 저장 절차에 따라 처리할 수
          있습니다.
        </p>
        <h2>5. 쿠키와 보호조치</h2>
        <p>
          로그인 세션과 Guest 기록 연결을 위해 HttpOnly·Secure·SameSite 쿠키를 사용합니다.
          비밀번호는 Argon2id로, 일회용 토큰과 세션 토큰은 원문이 아닌 해시로 저장합니다.
        </p>
        <h2>6. 이용자 권리와 문의</h2>
        <p>
          본인 정보의 열람·정정·삭제·처리 정지를 요청할 수 있으며, 로그인 후 내 기록 화면에서
          비밀번호로 본인을 다시 확인한 뒤 직접 회원 탈퇴할 수 있습니다. 문의:{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
        <p>
          WHICH 로그아웃·회원 탈퇴는 TikTok 계정 삭제나 TikTok 측 연동 권한 철회와 별개이며, TikTok
          권한을 자동으로 철회하지 않습니다. TikTok의 앱·서비스 권한 설정에서 WHICH의 접근 권한을
          철회할 수 있습니다. 자세한 방법은{" "}
          <a href="https://support.tiktok.com/en/safety-hc/account-and-user-safety/connect-to-third-party-apps">
            TikTok 공식 연결 앱 관리 안내
          </a>
          를 참고해 주세요. TikTok에서 권한을 철회하는 것만으로 WHICH 계정과 보관된 정보가 자동
          삭제되지는 않으므로, 정보 삭제를 원하면 WHICH 회원 탈퇴 또는 위 문의 경로를 이용해 주세요.
        </p>
      </article>
    </WhichShell>
  );
}
