import type { Metadata } from "next";

import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { sanitizeReturnTo, kakaoLoginEnabled, naverLoginEnabled } from "@/lib/server/member-auth";

export const metadata: Metadata = {
  title: "빠른 회원가입",
  description: "짧은 절차로 WHICH 계정을 만드세요.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const query = await searchParams;
  return (
    <CredentialAuthExperience
      mode="signup"
      returnTo={sanitizeReturnTo(query.returnTo ?? "/me")}
      providers={{ naver: naverLoginEnabled(), kakao: kakaoLoginEnabled() }}
    />
  );
}
