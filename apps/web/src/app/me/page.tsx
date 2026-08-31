import { MemberProfileExperience } from "@/features/identity/member-profile-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata = privatePageMetadata(
  "내 기록",
  "WHICH에서 내가 참여한 질문과 선택 결과를 확인하세요.",
);

export default async function MePage() {
  return <MemberProfileExperience creationEnabled={await creatorSubmissionsEnabled()} />;
}
