import type { Metadata } from "next";

import { ForgotPasswordExperience } from "@/features/identity/auth-recovery-experience";

export const metadata: Metadata = { title: "비밀번호 재설정" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordExperience />;
}
