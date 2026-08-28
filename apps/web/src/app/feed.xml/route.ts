import {
  canonicalUrl,
  issueIsIndexable,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/search-discovery";
import { readPublicIssueCatalogForDiscovery } from "@/lib/server/public-discovery";

export const dynamic = "force-dynamic";

const FEED_BASELINE_UPDATED_AT = "2026-08-29T00:00:00.000Z";

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
    issues[0]?.publishedAt ?? FEED_BASELINE_UPDATED_AT,
  );
  const entries = issues
    .map((issue) => {
      const link = canonicalUrl(`/issues/${encodeURIComponent(issue.id)}`);
      const choices = issue.choices.map((choice) => `${choice.code}. ${choice.label}`).join(" · ");
      const summary = [issue.context, choices, "먼저 선택한 뒤 결과를 확인하세요."]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ");
      return `<entry>
  <id>${escapeXml(link)}</id>
  <title>${escapeXml(issue.question)}</title>
  <link href="${escapeXml(link)}" />
  <updated>${escapeXml(issue.publishedAt)}</updated>
  <category term="${escapeXml(issue.categoryCode)}" />
  <summary>${escapeXml(summary)}</summary>
</entry>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ko">
  <id>${escapeXml(canonicalUrl("/"))}</id>
  <title>${SITE_NAME}</title>
  <subtitle>${escapeXml(SITE_DESCRIPTION)}</subtitle>
  <author><name>WHICH Editorial</name></author>
  <link href="${escapeXml(canonicalUrl("/feed.xml"))}" rel="self" />
  <link href="${escapeXml(canonicalUrl("/"))}" />
  <updated>${escapeXml(newest)}</updated>
${entries}
</feed>`;

  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
