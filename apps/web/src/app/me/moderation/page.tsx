import { MemberModerationExperience } from "@/features/identity/member-moderation-experience";
import { privatePageMetadata } from "@/lib/search-discovery";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata = privatePageMetadata(
  "내 Moderation",
  "콘텐츠와 이미지의 검수 상태, 재검토 및 권리 요청 결과를 확인하세요.",
);

export default function MemberModerationPage() {
  return <MemberModerationExperience creationEnabled={creatorSubmissionsEnabled()} />;
}
