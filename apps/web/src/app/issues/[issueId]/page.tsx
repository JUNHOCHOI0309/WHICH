import type { Metadata } from "next";

import { IssueExperience } from "@/features/issues/issue-experience";

type IssuePageProps = {
  params: Promise<{ issueId: string }>;
};

export const metadata: Metadata = {
  title: "질문에 참여하기",
  description: "A와 B 중 더 가까운 선택을 고르고 결과를 확인하세요.",
};

export default async function IssuePage({ params }: IssuePageProps) {
  const { issueId } = await params;
  return <IssueExperience issueId={issueId} />;
}
