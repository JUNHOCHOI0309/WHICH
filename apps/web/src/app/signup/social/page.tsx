import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SocialSignupExperience } from "@/features/identity/social-signup-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { SOCIAL_SIGNUP_COOKIE, decodeSocialSignupTicket } from "@/lib/server/member-auth";

export const metadata = privatePageMetadata(
  "소셜 회원가입",
  "소셜 인증을 WHICH 계정에 연결하세요.",
);

export default async function SocialSignupPage() {
  const ticket = decodeSocialSignupTicket((await cookies()).get(SOCIAL_SIGNUP_COOKIE)?.value);
  if (!ticket) redirect("/login?auth=expired");
  return (
    <SocialSignupExperience provider={ticket.provider} suggestedEmail={ticket.suggestedEmail} />
  );
}
