import {
  canonicalUrl,
  issueIsIndexable,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/search-discovery";
import { readPublicIssueCatalogForDiscovery } from "@/lib/server/public-discovery";

export const dynamic = "force-dynamic";

const RSS_BASELINE_UPDATED_AT = "2026-08-29T00:00:00.000Z";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const issues = (await readPublicIssueCatalogForDiscovery(50)).filter(issueIsIndexable);
  const newest = issues.reduce(
    (latest, issue) => (issue.publishedAt > latest ? issue.publishedAt : latest),
    issues[0]?.publishedAt ?? RSS_BASELINE_UPDATED_AT,
  );
  const items = issues
    .map((issue) => {
      const link = canonicalUrl(`/issues/${encodeURIComponent(issue.id)}`);
      const choices = issue.choices.map((choice) => `${choice.code}. ${choice.label}`).join(" · ");
      const description = [issue.context, choices, "먼저 선택한 뒤 결과를 확인하세요."]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ");
      return `<item>
  <title>${escapeXml(issue.question)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="true">${escapeXml(link)}</guid>
  <pubDate>${escapeXml(new Date(issue.publishedAt).toUTCString())}</pubDate>
  <category>${escapeXml(issue.categoryCode)}</category>
  <description>${escapeXml(description)}</description>
</item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
<channel>
  <title>${SITE_NAME}</title>
  <link>${escapeXml(canonicalUrl("/"))}</link>
  <description>${escapeXml(SITE_DESCRIPTION)}</description>
  <language>ko-KR</language>
  <lastBuildDate>${escapeXml(new Date(newest).toUTCString())}</lastBuildDate>
  <ttl>15</ttl>
${items}
</channel>
</rss>`;

  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
