import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StructuredData } from "@/components/search/structured-data";
import { CreatorProfileExperience } from "@/features/identity/creator-profile-experience";
import { canonicalUrl } from "@/lib/search-discovery";
import { readPublicCreatorForDiscovery } from "@/lib/server/public-discovery";

type CreatorPageProps = { params: Promise<{ handle: string }> };
const handlePattern = /^[A-Za-z0-9_]{3,30}$/;

export async function generateMetadata({ params }: CreatorPageProps): Promise<Metadata> {
  const { handle } = await params;
  if (!handlePattern.test(handle)) {
    return {
      title: "작성자 프로필",
      robots: { index: false, follow: false, nocache: true },
    };
  }
  const read = await readPublicCreatorForDiscovery(handle);
  if (read.status !== "available") {
    return {
      title: "작성자 프로필",
      robots: { index: false, follow: false, nocache: true },
    };
  }
  const profile = read.value;
  const canonical = `/user/${encodeURIComponent(profile.creator.handle)}`;
  const description =
    profile.creator.bio ??
    `${profile.creator.displayName}님이 WHICH에서 만든 공개 질문을 확인하고 선택해 보세요.`;
  const indexable = profile.stats.publishedIssueCount > 0;
  const image = profile.creator.avatar.kind === "IMAGE" ? profile.creator.avatar.url : undefined;
  return {
    title: `${profile.creator.displayName} (@${profile.creator.handle})`,
    description,
    alternates: { canonical },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: true, nocache: true },
    openGraph: {
      type: "profile",
      url: canonical,
      title: `${profile.creator.displayName} · WHICH 질문 작성자`,
      description,
      ...(image ? { images: [{ url: image, alt: profile.creator.displayName }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: `${profile.creator.displayName} · WHICH 질문 작성자`,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function CreatorProfilePage({ params }: CreatorPageProps) {
  const { handle } = await params;
  if (!handlePattern.test(handle)) notFound();
  const read = await readPublicCreatorForDiscovery(handle);
  if (read.status === "missing" || read.status === "unavailable") notFound();
  const profile = read.status === "available" ? read.value : null;
  return (
    <>
      {profile ? (
        <StructuredData
          data={{
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            "@id": canonicalUrl(`/user/${encodeURIComponent(profile.creator.handle)}`),
            url: canonicalUrl(`/user/${encodeURIComponent(profile.creator.handle)}`),
            inLanguage: "ko-KR",
            mainEntity: {
              "@type": "Person",
              name: profile.creator.displayName,
              alternateName: `@${profile.creator.handle}`,
              description: profile.creator.bio ?? undefined,
              ...(profile.creator.avatar.kind === "IMAGE"
                ? { image: profile.creator.avatar.url }
                : {}),
            },
          }}
        />
      ) : null}
      <CreatorProfileExperience handle={handle} initialProfile={profile ?? undefined} />
    </>
  );
}
