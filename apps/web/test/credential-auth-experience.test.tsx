import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { SocialSignupExperience } from "@/features/identity/social-signup-experience";

describe("Member credential authentication experience", () => {
  it("places enabled TikTok after Kakao and X on both auth forms", () => {
    const { rerender } = render(
      <CredentialAuthExperience
        mode="login"
        returnTo="/me"
        providers={{ naver: true, kakao: true, tiktok: true }}
      />,
    );
    const link = screen.getByRole("link", { name: "TikTok으로 계속하기" });
    expect(link).toHaveAttribute("href", "/api/auth/tiktok/start?returnTo=%2Fme");
    expect(link).toHaveAccessibleName("TikTok으로 계속하기");
    expect(link.querySelector("span > span")).toHaveTextContent("TikTok");
    expect(link.previousElementSibling).toHaveTextContent("X로 계속하기");
    expect(link.parentElement?.lastElementChild).toBe(link);
    rerender(
      <CredentialAuthExperience
        mode="signup"
        returnTo="/me"
        providers={{ naver: true, kakao: true, tiktok: true }}
      />,
    );
    expect(screen.getByRole("link", { name: "TikTok으로 계속하기" })).toBeVisible();
  });

  it("asks TikTok members for their WHICH email instead of inventing one", () => {
    render(<SocialSignupExperience provider="TIKTOK" />);
    expect(screen.getByRole("textbox", { name: "이메일" })).toHaveValue("");
  });

  it("keeps email/password as the main login path and four social branches on one page", () => {
    render(
      <CredentialAuthExperience
        mode="login"
        returnTo="/me"
        providers={{ naver: true, kakao: true }}
      />,
    );

    expect(screen.getByRole("heading", { name: "WHICH" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "이메일" })).toBeVisible();
    expect(screen.getByLabelText("WHICH 비밀번호")).toBeVisible();
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "비밀번호를 잊었거나 이메일 확인이 필요한가요?" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: "Google로 계속하기" })).toHaveAttribute(
      "href",
      "/api/auth/google/start?returnTo=%2Fme",
    );
    expect(screen.getByRole("link", { name: "네이버로 계속하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "X로 계속하기" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "TikTok으로 계속하기" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "홈" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "관심사" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "로그인" })).toHaveLength(3);
  });

  it("marks only the most recently used login provider", () => {
    render(
      <CredentialAuthExperience
        mode="login"
        returnTo="/me"
        providers={{ naver: true, kakao: true, tiktok: true }}
        recentLoginProvider="kakao"
      />,
    );

    const recent = screen.getByRole("link", { name: "카카오로 계속하기, 최근 로그인" });
    expect(recent).toHaveTextContent("최근 로그인");
    expect(screen.getAllByText("최근 로그인")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "로그인" })).not.toHaveTextContent("최근 로그인");
  });

  it("marks email/password when it was used most recently", () => {
    render(
      <CredentialAuthExperience
        mode="login"
        returnTo="/me"
        providers={{ naver: true, kakao: true }}
        recentLoginProvider="email"
      />,
    );

    expect(screen.getByRole("button", { name: "로그인, 최근 로그인" })).toHaveTextContent(
      "최근 로그인",
    );
    expect(screen.getAllByText("최근 로그인")).toHaveLength(1);
  });

  it("links signup consent to the published terms and privacy policy", () => {
    render(
      <CredentialAuthExperience
        mode="signup"
        returnTo="/me"
        providers={{ naver: true, kakao: true }}
      />,
    );
    expect(screen.getByRole("heading", { name: "회원가입" })).toBeVisible();
    expect(screen.queryByText("빠르게 WHICH 계정을 만들어요.")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "이메일과 비밀번호만 정하면 됩니다. Handle과 소개는 나중에 설정할 수 있어요.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: "서비스 이용약관" })
        .some((link) => link.matches('[href="/legal/terms"][target="_blank"]')),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "개인정보 처리방침" })
        .some((link) => link.matches('[href="/legal/privacy"][target="_blank"]')),
    ).toBe(true);
    expect(screen.getByText(/게시하는 콘텐츠에 필요한 권리를 보유하며/)).toBeVisible();
    expect(screen.getByText(/자동 안전 검수와 신고·권리 요청 결과/)).toBeVisible();
  });

  it("shows and applies the new password requirements during signup", () => {
    render(
      <CredentialAuthExperience
        mode="signup"
        returnTo="/me"
        providers={{ naver: true, kakao: true }}
      />,
    );

    expect(screen.getByText("8~15자, 특수문자 1개 이상 필수")).toBeVisible();
    expect(screen.getByLabelText(/WHICH 비밀번호/)).toHaveAttribute("minlength", "8");
    expect(screen.getByLabelText(/WHICH 비밀번호/)).toHaveAttribute("maxlength", "15");
  });

  it("lets an authenticated social Guest choose quick signup or an existing account", () => {
    render(<SocialSignupExperience provider="KAKAO" suggestedEmail="member@example.com" />);

    expect(screen.getByDisplayValue("member@example.com")).toBeVisible();
    expect(screen.getByText(/게시하는 콘텐츠에 필요한 권리를 보유하며/)).toBeVisible();
    expect(screen.getByRole("button", { name: "가입하고 기록 이어받기" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "기존 계정에 연결" }));
    expect(screen.getByRole("heading", { name: "기존 WHICH 계정에 연결해요." })).toBeVisible();
    expect(screen.getByRole("button", { name: "확인하고 연결하기" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "홈" })).toHaveLength(2);
  });
});
