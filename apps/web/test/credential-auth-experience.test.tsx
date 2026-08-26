import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { SocialSignupExperience } from "@/features/identity/social-signup-experience";

describe("Member credential authentication experience", () => {
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
    expect(screen.getAllByRole("link", { name: "홈" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "관심사" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "로그인" })).toHaveLength(3);
  });

  it("links signup consent to the published terms and privacy policy", () => {
    render(
      <CredentialAuthExperience
        mode="signup"
        returnTo="/me"
        providers={{ naver: true, kakao: true }}
      />,
    );
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
    expect(screen.getByRole("button", { name: "가입하고 기록 이어받기" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "기존 계정에 연결" }));
    expect(screen.getByRole("heading", { name: "기존 WHICH 계정에 연결해요." })).toBeVisible();
    expect(screen.getByRole("button", { name: "확인하고 연결하기" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "홈" })).toHaveLength(2);
  });
});
