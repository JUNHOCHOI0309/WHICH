import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPolicyPage from "@/app/legal/privacy/page";

vi.mock("@/components/layout/which-shell", () => ({
  WhichShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  WhichAsideCard: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Privacy policy TikTok disclosure", () => {
  it("describes the requested basic profile fields and their limited purposes", () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole("heading", { name: "개인정보 처리방침", level: 1 })).toBeVisible();
    expect(screen.getByText(/TikTok 로그인 선택·동의 시:/)).toHaveTextContent(
      "앱 내 계정 식별자(open_id), 표시 이름(display_name), 프로필 이미지 주소(avatar_url)",
    );
    expect(screen.getByText(/기본 프로필 권한\(user.info.basic\)만 요청/)).toHaveTextContent(
      "영상 게시 권한도 요청하지 않습니다",
    );
    expect(screen.getByText(/TikTok에서 받은 정보는 로그인할 회원의 식별/)).toHaveTextContent(
      "기존 계정과 자동 병합하지 않습니다",
    );
  });

  it("distinguishes temporary signup information from provider tokens", () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByText(/암호화한 임시 가입 쿠키/)).toHaveTextContent("최대 10분");
    expect(screen.getByText(/암호화한 임시 가입 쿠키/)).toHaveTextContent(
      "가입·연결 완료 시 이 쿠키를 삭제",
    );
    expect(screen.getByText(/TikTok 액세스 토큰은 인증과 기본 프로필 확인/)).toHaveTextContent(
      "TikTok 액세스·갱신 토큰은 데이터베이스나 브라우저 쿠키에 저장하지 않습니다",
    );
  });

  it("lists TikTok and preserves the distinction between revocation and account deletion", () => {
    vi.stubEnv("SUPPORT_EMAIL", "privacy-test@example.com");
    render(<PrivacyPolicyPage />);

    expect(screen.getByText(/서비스 운영을 위해 Render/)).toHaveTextContent(
      "Google·X·네이버·카카오·TikTok",
    );
    expect(screen.getByText(/TikTok 로그인을 선택하면 인증 코드 교환/)).toHaveTextContent(
      "투표·댓글·포인트 기록은 전달하지 않습니다",
    );
    expect(screen.getByText(/WHICH 로그아웃·회원 탈퇴는 TikTok 계정 삭제/)).toHaveTextContent(
      "권한을 자동으로 철회하지 않습니다",
    );
    expect(screen.getByText(/WHICH 로그아웃·회원 탈퇴는 TikTok 계정 삭제/)).toHaveTextContent(
      "자동 삭제되지는 않으므로",
    );
    expect(screen.getByRole("link", { name: "TikTok 공식 연결 앱 관리 안내" })).toHaveAttribute(
      "href",
      "https://support.tiktok.com/en/safety-hc/account-and-user-safety/connect-to-third-party-apps",
    );
    expect(screen.getByRole("link", { name: "privacy-test@example.com" })).toHaveAttribute(
      "href",
      "mailto:privacy-test@example.com",
    );
  });
});
