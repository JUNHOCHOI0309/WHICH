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

    expect(screen.getByRole("textbox", { name: "이메일" })).toBeVisible();
    expect(screen.getByLabelText("WHICH 비밀번호")).toBeVisible();
    expect(screen.getByRole("button", { name: "로그인" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Google로 계속하기" })).toHaveAttribute(
      "href",
      "/api/auth/google/start?returnTo=%2Fme",
    );
    expect(screen.getByRole("link", { name: "네이버로 계속하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "카카오로 계속하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "X로 계속하기" })).toBeVisible();
  });

  it("lets an authenticated social Guest choose quick signup or an existing account", () => {
    render(<SocialSignupExperience provider="KAKAO" suggestedEmail="member@example.com" />);

    expect(screen.getByDisplayValue("member@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "가입하고 기록 이어받기" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "기존 계정에 연결" }));
    expect(screen.getByRole("heading", { name: "기존 WHICH 계정에 연결해요." })).toBeVisible();
    expect(screen.getByRole("button", { name: "확인하고 연결하기" })).toBeVisible();
  });
});
