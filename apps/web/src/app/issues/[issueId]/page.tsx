import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StructuredData } from "@/components/search/structured-data";
import { IssueExperience } from "@/features/issues/issue-experience";
import type { PublicShareCard } from "@/lib/contracts";
import {
  canonicalUrl,
  issueCanonicalPath,
  issueIsIndexable,
  issueSearchDescription,
} from "@/lib/search-discovery";
import { kakaoLoginEnabled, naverLoginEnabled } from "@/lib/server/member-auth";
import { readPublicIssueForDiscovery } from "@/lib/server/public-discovery";
import { readResultShareCard } from "@/lib/server/result-sharing";

type IssuePageProps = {
  params: Promise<{ issueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailableMetadata(): Metadata {
  return {
    title: "질문을 확인할 수 없습니다",
    description: "현재 공개된 질문인지 확인한 뒤 다시 시도해 주세요.",
    robots: { index: false, follow: false, nocache: true },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: IssuePageProps): Promise<Metadata> {
  const { issueId } = await params;
  if (!uuidPattern.test(issueId)) return unavailableMetadata();
  const issueRead = await readPublicIssueForDiscovery(issueId);
  if (issueRead.status !== "available") return unavailableMetadata();

  const issue = issueRead.value;
  const canonicalPath = issueCanonicalPath(issue.id);
  const description = issueSearchDescription(issue);
  const indexable = issueIsIndexable(issue);
  const query = await searchParams;
  const shareValue = query.share;
  const shareId =
    typeof shareValue === "string" && uuidPattern.test(shareValue) ? shareValue : null;
  const hasVariantParameters = Object.keys(query).length > 0;

  const base: Metadata = {
    title: issue.question,
    description,
    alternates: { canonical: canonicalPath },
    robots:
      indexable && !hasVariantParameters
        ? { index: true, follow: true }
        : { index: false, follow: true, nocache: true },
    openGraph: {
      title: issue.question,
      description,
      type: "website",
      url: canonicalPath,
      images: [
        {
          url: `${canonicalPath}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `${issue.question} — ${issue.choices.map((choice) => choice.label).join(" 또는 ")}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: issue.question,
      description,
      images: [`${canonicalPath}/opengraph-image`],
    },
  };

  if (!shareId) return base;

  try {
    const response = await readResultShareCard(shareId);
    if (!response.ok) return base;
    const card = (await response.json()) as PublicShareCard;
    if (card.issue.id !== issue.id || card.issue.version !== issue.version) return base;
    const total = card.result.displayedTotal;
    const aPercent = total === 0 ? 0 : Math.round((card.result.acceptedA / total) * 100);
    const selected = card.sharedChoiceCode ? ` · 공유한 선택 ${card.sharedChoiceCode}` : "";
    const shareDescription = `A ${aPercent}% · B ${100 - aPercent}%${selected}. 먼저 골라보고 결과를 확인하세요.`;
    return {
      ...base,
      description: shareDescription,
      robots: { index: false, follow: true, nocache: true },
      openGraph: {
        title: card.issue.question,
        description: shareDescription,
        type: "website",
        url: canonicalPath,
        images: [{ url: `/api/share-cards/${card.id}/image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: card.issue.question,
        description: shareDescription,
        images: [`/api/share-cards/${card.id}/image`],
      },
    };
  } catch {
    return base;
  }
}

export default async function IssuePage({ params }: IssuePageProps) {
  const { issueId } = await params;
  if (!uuidPattern.test(issueId)) notFound();
  const issueRead = await readPublicIssueForDiscovery(issueId);
  if (issueRead.status === "missing" || issueRead.status === "unavailable") notFound();

  const issue = issueRead.status === "available" ? issueRead.value : null;
  return (
    <>
      {issue ? (
        <StructuredData
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebPage",
                "@id": canonicalUrl(issueCanonicalPath(issue.id)),
                url: canonicalUrl(issueCanonicalPath(issue.id)),
                name: issue.question,
                description: issueSearchDescription(issue),
                datePublished: issue.publishedAt,
                inLanguage: "ko-KR",
                isPartOf: { "@id": `${canonicalUrl("/")}#website` },
              },
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "WHICH",
                    item: canonicalUrl("/"),
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: issue.question,
                    item: canonicalUrl(issueCanonicalPath(issue.id)),
                  },
                ],
              },
            ],
          }}
        />
      ) : null}
      <IssueExperience
        issueId={issueId}
        initialIssue={issue ?? undefined}
        kakaoLoginEnabled={kakaoLoginEnabled()}
        naverLoginEnabled={naverLoginEnabled()}
      />
    </>
  );
}
