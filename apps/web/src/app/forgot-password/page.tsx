import { ForgotPasswordExperience } from "@/features/identity/auth-recovery-experience";
import { privatePageMetadata } from "@/lib/search-discovery";

export const metadata = privatePageMetadata("비밀번호 재설정");

export default function ForgotPasswordPage() {
  return <ForgotPasswordExperience />;
}
