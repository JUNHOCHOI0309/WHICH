import { ResetPasswordExperience } from "@/features/identity/auth-recovery-experience";
import { privatePageMetadata } from "@/lib/search-discovery";

export const metadata = privatePageMetadata("새 비밀번호 설정");

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const query = await searchParams;
  return <ResetPasswordExperience token={query.token?.slice(0, 256) ?? ""} />;
}
