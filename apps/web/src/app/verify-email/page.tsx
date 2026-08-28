import { VerifyEmailExperience } from "@/features/identity/auth-recovery-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { sanitizeReturnTo } from "@/lib/server/member-auth";

export const metadata = privatePageMetadata("이메일 확인");

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; status?: string; sent?: string; returnTo?: string }>;
}) {
  const query = await searchParams;
  const status =
    query.status === "verified" || query.status === "invalid" ? query.status : undefined;
  return (
    <VerifyEmailExperience
      initialEmail={query.email?.slice(0, 320) ?? ""}
      status={status}
      deliveryState={query.sent === "1" ? "sent" : query.sent === "0" ? "unavailable" : undefined}
      returnTo={sanitizeReturnTo(query.returnTo ?? "/me")}
    />
  );
}
