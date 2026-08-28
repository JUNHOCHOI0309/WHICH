import type { MetadataRoute } from "next";

import { canonicalUrl, issueIsIndexable } from "@/lib/search-discovery";
import { readPublicIssueCatalogForDiscovery } from "@/lib/server/public-discovery";

export const dynamic = "force-dynamic";

const staticRoutes: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  lastModified?: string;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  {
    path: "/about",
    changeFrequency: "monthly",
    priority: 0.7,
    lastModified: "2026-08-29",
  },
  {
    path: "/methodology",
    changeFrequency: "monthly",
    priority: 0.8,
    lastModified: "2026-08-29",
  },
  {
    path: "/editorial-policy",
    changeFrequency: "monthly",
    priority: 0.7,
    lastModified: "2026-08-29",
  },
  {
    path: "/vote-integrity",
    changeFrequency: "monthly",
    priority: 0.8,
    lastModified: "2026-08-29",
  },
  {
    path: "/moderation-policy",
    changeFrequency: "monthly",
    priority: 0.7,
    lastModified: "2026-08-29",
  },
  {
    path: "/corrections",
    changeFrequency: "monthly",
    priority: 0.6,
    lastModified: "2026-08-29",
  },
  {
    path: "/legal/terms",
    changeFrequency: "yearly",
    priority: 0.4,
    lastModified: "2026-08-24",
  },
  {
    path: "/legal/privacy",
    changeFrequency: "yearly",
    priority: 0.4,
    lastModified: "2026-08-25",
  },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: canonicalUrl(route.path),
    ...(route.lastModified ? { lastModified: new Date(route.lastModified) } : {}),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  const issues = await readPublicIssueCatalogForDiscovery();
  const issueEntries: MetadataRoute.Sitemap = issues.filter(issueIsIndexable).map((issue) => ({
    url: canonicalUrl(`/issues/${encodeURIComponent(issue.id)}`),
    lastModified: new Date(issue.publishedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  return [...staticEntries, ...issueEntries];
}
