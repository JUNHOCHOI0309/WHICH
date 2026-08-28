import type { Metadata } from "next";

import { StructuredData } from "@/components/search/structured-data";
import { FeedExperience } from "@/features/feed/feed-experience";
import { canonicalUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/search-discovery";
import { creatorSubmissionsEnabled } from "@/lib/server/feature-flags";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: {
      "application/atom+xml": "/feed.xml",
      "application/rss+xml": "/rss.xml",
    },
  },
};

export default function Home() {
  return (
    <>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${canonicalUrl("/")}#organization`,
              name: SITE_NAME,
              url: canonicalUrl("/"),
              logo: canonicalUrl("/icons/which-icon-192.png"),
            },
            {
              "@type": "WebSite",
              "@id": `${canonicalUrl("/")}#website`,
              name: SITE_NAME,
              description: SITE_DESCRIPTION,
              url: canonicalUrl("/"),
              inLanguage: "ko-KR",
              publisher: { "@id": `${canonicalUrl("/")}#organization` },
            },
          ],
        }}
      />
      <FeedExperience creationEnabled={creatorSubmissionsEnabled()} />
    </>
  );
}
