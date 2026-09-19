import type { z } from "zod";
import type { radarSourceSchema } from "./contracts.js";

export type RadarSource = z.infer<typeof radarSourceSchema>;
export const RADAR_POLICY_VERSION = "radar-sources-2026-09-20-v3";
export const RADAR_POLICY_REVIEW_DUE = "2026-10-19T00:00:00Z";
export const RADAR_CAPABILITIES = [
  "collect",
  "store",
  "redisplay",
  "derive",
  "inference",
  "train",
] as const;
export type RadarCapability = (typeof RADAR_CAPABILITIES)[number];

export interface RadarBudget {
  /** Shared by every operation drawing from the same provider quota bucket. */
  pool: string;
  timeZone: string;
  requestsPerRun: number;
  requestsPerDay: number;
  unitsPerRun: number;
  unitsPerDay: number;
  unitCost: number;
}

interface RadarSourceRegistration {
  reviewedAt: string;
  evidence: readonly string[];
  credential: "NONE" | "NAVER_API_HUB_APPLICATION" | "YOUTUBE_PROJECT";
  /** Internal ceiling, not a grant of storage rights from the provider. */
  retentionCeilingHours: number;
  operations: Readonly<Record<string, RadarBudget>>;
}

const budget = (
  pool: string,
  timeZone: string,
  requestsPerRun: number,
  requestsPerDay: number,
): RadarBudget => ({
  pool,
  timeZone,
  requestsPerRun,
  requestsPerDay,
  unitsPerRun: requestsPerRun,
  unitsPerDay: requestsPerDay,
  unitCost: 1,
});

// This register does not enable collectors. Account/use-case approvals are separate.
// All numbers below are WHICH soft caps, not an account's allocated provider quota.
export const radarSourceRegistry: Readonly<Record<RadarSource, RadarSourceRegistration>> = {
  GOOGLE_TRENDING_RSS: {
    reviewedAt: "2026-09-19",
    credential: "NONE",
    retentionCeilingHours: 24,
    evidence: ["https://support.google.com/trends/answer/3076011?hl=en"],
    operations: { "trending.rss": budget("google-rss", "UTC", 1, 144) },
  },
  NAVER_SEARCH: {
    reviewedAt: "2026-09-20",
    credential: "NAVER_API_HUB_APPLICATION",
    retentionCeilingHours: 24,
    evidence: [
      "https://api.ncloud-docs.com/docs/naver-api-hub-search-news",
      "https://guide.ncloud-docs.com/docs/apihub-migration",
      "https://guide.ncloud-docs.com/docs/apihub-overview",
    ],
    operations: { "news.search": budget("naver-search", "Asia/Seoul", 10, 300) },
  },
  NAVER_DATALAB: {
    reviewedAt: "2026-09-20",
    credential: "NAVER_API_HUB_APPLICATION",
    retentionCeilingHours: 24,
    evidence: [
      "https://api.ncloud-docs.com/docs/naver-api-hub-search-trend",
      "https://guide.ncloud-docs.com/docs/apihub-migration",
      "https://guide.ncloud-docs.com/docs/apihub-overview",
    ],
    operations: { "search.trend": budget("naver-datalab", "Asia/Seoul", 5, 50) },
  },
  YOUTUBE_DATA_API: {
    reviewedAt: "2026-09-20",
    credential: "YOUTUBE_PROJECT",
    retentionCeilingHours: 24,
    evidence: [
      "https://developers.google.com/youtube/v3/docs/search/list",
      "https://developers.google.com/youtube/v3/docs/videos/list",
      "https://developers.google.com/youtube/v3/determine_quota_cost",
      "https://developers.google.com/youtube/terms/developer-policies",
      "https://developers.google.com/youtube/terms/derived-metrics-policy",
    ],
    operations: {
      "search.list": budget("youtube-search", "America/Los_Angeles", 2, 20),
      "videos.list": budget("youtube-general", "America/Los_Angeles", 50, 500),
      "channels.list": budget("youtube-general", "America/Los_Angeles", 50, 500),
    },
  },
};

// Alpha is deliberately outside the executable R01 source enum. Never fall back
// to unofficial endpoints when approval or implementation is absent.
export const radarDeferredSources = [
  {
    source: "GOOGLE_TRENDS_ALPHA",
    enabled: false,
    reason: "ACCOUNT_APPROVAL_AND_ADAPTER_REQUIRED",
    evidence: "https://developers.google.com/search/apis/trends",
  },
] as const;
