import type { Metadata } from "next";

import { IssueExperience } from "@/features/issues/issue-experience";
import { naverLoginEnabled } from "@/lib/server/member-auth";
import type { PublicShareCard } from "@/lib/contracts";
import { readResultShareCard } from "@/lib/server/result-sharing";

type IssuePageProps = {
  params: Promise<{ issueId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: IssuePageProps): Promise<Metadata> {
  const { issueId } = await params;
  const shareValue = (await searchParams).share;
  const shareId =
    typeof shareValue === "string" && uuidPattern.test(shareValue) ? shareValue : null;
  if (!shareId) {
    return {
      title: "질문에 참여하기",
      description: "A와 B 중 더 가까운 선택을 고르고 결과를 확인하세요.",
    };
  }
  try {
    const response = await readResultShareCard(shareId);
    if (!response.ok) throw new Error("Share Card unavailable");
    const card = (await response.json()) as PublicShareCard;
    if (card.issue.id !== issueId) throw new Error("Share Card Issue mismatch");
    const total = card.result.displayedTotal;
    const aPercent = total === 0 ? 0 : Math.round((card.result.acceptedA / total) * 100);
    const selected = card.sharedChoiceCode ? ` · 공유한 선택 ${card.sharedChoiceCode}` : "";
    const description = `A ${aPercent}% · B ${100 - aPercent}%${selected}. 먼저 골라보고 결과를 확인하세요.`;
    return {
      title: card.issue.question,
      description,
      openGraph: {
        title: card.issue.question,
        description,
        type: "website",
        images: [{ url: `/api/share-cards/${card.id}/image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: card.issue.question,
        description,
        images: [`/api/share-cards/${card.id}/image`],
      },
    };
  } catch {
    return {
      title: "질문에 참여하기",
      description: "A와 B 중 더 가까운 선택을 고르고 결과를 확인하세요.",
    };
  }
}

export default async function IssuePage({ params }: IssuePageProps) {
  const { issueId } = await params;
  return <IssueExperience issueId={issueId} naverLoginEnabled={naverLoginEnabled()} />;
}
