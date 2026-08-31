import { MemberSubmissionsExperience } from "@/features/issues/member-submissions-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata = privatePageMetadata(
  "내 질문",
  "제출한 질문의 게시 상태를 확인하고 관리하세요.",
);

export default async function SubmissionsPage() {
  return <MemberSubmissionsExperience creationEnabled={await creatorSubmissionsEnabled()} />;
}
