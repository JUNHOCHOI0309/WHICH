import { CredentialAuthExperience } from "@/features/identity/credential-auth-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { tiktokLoginAvailable } from "@/lib/server/tiktok-oauth";
import { sanitizeReturnTo, kakaoLoginEnabled, naverLoginEnabled } from "@/lib/server/member-auth";

export const metadata = privatePageMetadata("로그인", "WHICH 계정으로 로그인하세요.");

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
      providers={{
        naver: naverLoginEnabled(),
        kakao: kakaoLoginEnabled(),
        tiktok: tiktokLoginAvailable(query.returnTo),
      }}
    />
  );
}
