import type { Metadata } from "next";

import { MemberVoteHistoryExperience } from "@/features/identity/member-vote-history-experience";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata: Metadata = {
  title: "투표 기록",
  description: "WHICH에서 내가 고른 선택과 현재 결과를 월별로 확인하세요.",
};

export default function MemberVoteHistoryPage() {
  return <MemberVoteHistoryExperience creationEnabled={creatorSubmissionsEnabled()} />;
}
