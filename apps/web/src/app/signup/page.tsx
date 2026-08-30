import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { tiktokLoginAvailable } from "@/lib/server/tiktok-oauth";
import { sanitizeReturnTo, kakaoLoginEnabled, naverLoginEnabled } from "@/lib/server/member-auth";

export const metadata = privatePageMetadata("빠른 회원가입", "짧은 절차로 WHICH 계정을 만드세요.");

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
      providers={{
        naver: naverLoginEnabled(),
        kakao: kakaoLoginEnabled(),
        tiktok: tiktokLoginAvailable(query.returnTo),
      }}
    />
  );
}
