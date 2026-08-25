import type { Metadata } from "next";

import { MemberProfileExperience } from "@/features/identity/member-profile-experience";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata: Metadata = {
  title: "내 기록",
  description: "WHICH에서 내가 참여한 질문과 선택 결과를 확인하세요.",
};

export default function MePage() {
  return <MemberProfileExperience creationEnabled={creatorSubmissionsEnabled()} />;
}
