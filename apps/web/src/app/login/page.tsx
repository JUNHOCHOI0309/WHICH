import type { Metadata } from "next";

import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { sanitizeReturnTo, kakaoLoginEnabled, naverLoginEnabled } from "@/lib/server/member-auth";

export const metadata: Metadata = { title: "로그인", description: "WHICH 계정으로 로그인하세요." };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const query = await searchParams;
  return (
    <CredentialAuthExperience
      mode="login"
      returnTo={sanitizeReturnTo(query.returnTo ?? "/me")}
      providers={{ naver: naverLoginEnabled(), kakao: kakaoLoginEnabled() }}
    />
  );
}
