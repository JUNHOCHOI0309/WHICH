import { createHash } from "node:crypto";

import { z } from "zod";

import type { RadarObservation } from "../../contracts.js";
import type { RadarCompletion } from "../../ingestion-service.js";
import { normalizeRadarObservation } from "../../normalize.js";
import {
  invalidYouTubeResponse,
  requestYouTubeDataApiJson,
  type YouTubeDataApiCredentials,
  type YouTubeFetch,
  type YouTubeRequestContext,
} from "./common.js";

export const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";

const timestamp = z.iso.datetime({ offset: true });
const videoId = z.string().regex(/^[0-9A-Za-z_-]{11}$/);
const count = z.string().regex(/^\d+$/).max(20);
const itemSchema = z.object({
  id: videoId,
  snippet: z.object({
    publishedAt: timestamp,
    channelId: z.string().trim().min(1).max(100),
    title: z.string().max(4_000),
    channelTitle: z.string().max(500),
  }),
  statistics: z.object({
    viewCount: count.optional(),
    likeCount: count.optional(),
    commentCount: count.optional(),
  }),
});
const responseSchema = z.object({ items: z.array(itemSchema).max(50) });
const chartResponseSchema = z.object({
  nextPageToken: z.string().min(1).max(1_000).optional(),
  pageInfo: z
    .object({
      totalResults: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      resultsPerPage: z.number().int().nonnegative().max(50),
    })
    .optional(),
  items: z.array(itemSchema).max(50),
});
const statisticsInputSchema = z.strictObject({
  videoIds: z.array(videoId).min(1).max(100),
});
const chartInputSchema = z.strictObject({
  regionCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("KR"),
  videoCategoryId: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  maxResults: z.number().int().min(1).max(50).default(25),
});

export type YouTubeVideoRecord = {
  sourceItemId: string;
  videoId: string;
  sourceUrl: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  observedAt: string;
  statistics: {
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
  };
};

export type YouTubeVideoStatisticsCollection = {
  fetchedAt: string;
  requestedVideoIds: string[];
  returnedVideoIds: string[];
  missingVideoIds: string[];
  records: YouTubeVideoRecord[];
  observations: RadarObservation[];
  completion: RadarCompletion;
};

export type YouTubeMostPopularScope = {
  key: string;
  regionCode: string;
  videoCategoryId: string | null;
  resultLimit: number;
  meaning: "YOUTUBE_MOST_POPULAR_CHART_NOT_TRENDING_NOW";
};

export type YouTubeMostPopularCollection = {
  fetchedAt: string;
  scope: YouTubeMostPopularScope;
  nextPageAvailable: boolean;
  records: YouTubeVideoRecord[];
  observations: RadarObservation[];
  completion: RadarCompletion;
};

type SharedOptions = {
  sampledAt: string;
  requestKey: string;
  credentials?: YouTubeDataApiCredentials;
  fetchImpl?: YouTubeFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

type StatisticsOptions = z.input<typeof statisticsInputSchema> & SharedOptions;
type ChartOptions = z.input<typeof chartInputSchema> & SharedOptions;

function normalizedText(value: string, maximumLength: number) {
  const result = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!result || result.length > maximumLength) throw invalidYouTubeResponse();
  return result;
}

function parseCount(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidYouTubeResponse();
  return parsed;
}

function toRecord(item: z.infer<typeof itemSchema>, fetchedAt: string): YouTubeVideoRecord {
  return {
    sourceItemId: `youtube-video:${item.id}`,
    videoId: item.id,
    sourceUrl: `https://www.youtube.com/watch?v=${item.id}`,
    title: normalizedText(item.snippet.title, 500),
    channelId: normalizedText(item.snippet.channelId, 100),
    channelTitle: normalizedText(item.snippet.channelTitle, 500),
    publishedAt: item.snippet.publishedAt,
    observedAt: fetchedAt,
    statistics: {
      viewCount: parseCount(item.statistics.viewCount),
      likeCount: parseCount(item.statistics.likeCount),
      commentCount: parseCount(item.statistics.commentCount),
    },
  };
}

function metricObservations(record: YouTubeVideoRecord, sampledAt: string) {
  const metrics = [
    ["VIEW_COUNT", record.statistics.viewCount],
    ["LIKE_COUNT", record.statistics.likeCount],
    ["COMMENT_COUNT", record.statistics.commentCount],
  ] as const;
  return metrics.flatMap(([metricName, value]) =>
    value === null
      ? []
      : [
          normalizeRadarObservation({
            source: "YOUTUBE_DATA_API",
            sourceItemId: record.sourceItemId,
            sourceUrl: record.sourceUrl,
            title: record.title,
            metricName,
            scope: {
              // Video resource counts are global snapshots, not region-specific statistics.
              countryCode: "ZZ",
              queryKey: record.videoId,
              dimensionsKey: "resource=video;selection=explicit-ids;geo=global",
            },
            window: { start: sampledAt, end: sampledAt, granularity: "SNAPSHOT" },
            sampledAt,
            sourceUpdatedAt: null,
            metric: { kind: "COUNT", value },
          }).observation,
        ],
  );
}

function chartScope(input: z.output<typeof chartInputSchema>): YouTubeMostPopularScope {
  const payload = {
    regionCode: input.regionCode,
    videoCategoryId: input.videoCategoryId ?? null,
    resultLimit: input.maxResults,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(["youtube-most-popular-scope-v1", payload]))
    .digest("hex");
  return {
    key: `youtube-most-popular:${digest}`,
    ...payload,
    meaning: "YOUTUBE_MOST_POPULAR_CHART_NOT_TRENDING_NOW",
  };
}

function commonRequestOptions(options: SharedOptions) {
  return {
    requestKey: options.requestKey,
    credentials: options.credentials,
    fetchImpl: options.fetchImpl,
    timeoutMilliseconds: options.timeoutMilliseconds,
    maxResponseBytes: options.maxResponseBytes,
    now: options.now,
  };
}

export async function collectYouTubeVideoStatistics(
  context: YouTubeRequestContext,
  options: StatisticsOptions,
): Promise<YouTubeVideoStatisticsCollection> {
  const sampledAt = timestamp.parse(options.sampledAt);
  const parsedInput = statisticsInputSchema.parse({ videoIds: options.videoIds });
  const requestedVideoIds = [...new Set(parsedInput.videoIds)];
  if (requestedVideoIds.length > 50) throw new Error("TOO_MANY_UNIQUE_YOUTUBE_VIDEO_IDS");
  const shared = commonRequestOptions(options);
  const { payload, fetchedAt } = await requestYouTubeDataApiJson({
    ...shared,
    context,
    operation: "videos.list",
    path: "/youtube/v3/videos",
    parameters: {
      part: "snippet,statistics",
      id: requestedVideoIds.join(","),
      fields:
        "items(id,snippet(publishedAt,channelId,title,channelTitle),statistics(viewCount,likeCount,commentCount))",
    },
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw invalidYouTubeResponse();
  const requested = new Set(requestedVideoIds);
  const recordsById = new Map<string, YouTubeVideoRecord>();
  for (const item of parsed.data.items) {
    if (!requested.has(item.id) || recordsById.has(item.id)) throw invalidYouTubeResponse();
    recordsById.set(item.id, toRecord(item, fetchedAt));
  }
  const records = requestedVideoIds.flatMap((id) => {
    const record = recordsById.get(id);
    return record ? [record] : [];
  });
  const observations = records.flatMap((record) => metricObservations(record, sampledAt));
  return {
    fetchedAt,
    requestedVideoIds,
    returnedVideoIds: records.map((record) => record.videoId),
    missingVideoIds: requestedVideoIds.filter((id) => !recordsById.has(id)),
    records,
    observations,
    completion: {
      status: observations.length ? "SUCCEEDED" : "EMPTY_VALID",
      pageCount: 1,
      observationCount: observations.length,
      truncated: false,
      missingCoverage: [],
      failureCode: null,
    },
  };
}

export async function collectYouTubeMostPopularChart(
  context: YouTubeRequestContext,
  options: ChartOptions,
): Promise<YouTubeMostPopularCollection> {
  const sampledAt = timestamp.parse(options.sampledAt);
  const input = chartInputSchema.parse({
    regionCode: options.regionCode,
    videoCategoryId: options.videoCategoryId,
    maxResults: options.maxResults,
  });
  const scope = chartScope(input);
  const parameters: Record<string, string> = {
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode: input.regionCode,
    maxResults: String(input.maxResults),
    fields:
      "nextPageToken,pageInfo(totalResults,resultsPerPage),items(id,snippet(publishedAt,channelId,title,channelTitle),statistics(viewCount,likeCount,commentCount))",
  };
  if (input.videoCategoryId) parameters.videoCategoryId = input.videoCategoryId;
  const shared = commonRequestOptions(options);
  const { payload, fetchedAt } = await requestYouTubeDataApiJson({
    ...shared,
    context,
    operation: "videos.list",
    path: "/youtube/v3/videos",
    parameters,
  });
  const parsed = chartResponseSchema.safeParse(payload);
  if (!parsed.success) throw invalidYouTubeResponse();
  if (
    parsed.data.items.length > input.maxResults ||
    (parsed.data.pageInfo && parsed.data.pageInfo.resultsPerPage < parsed.data.items.length)
  ) {
    throw invalidYouTubeResponse();
  }
  const seen = new Set<string>();
  const records = parsed.data.items.map((item) => {
    if (seen.has(item.id)) throw invalidYouTubeResponse();
    seen.add(item.id);
    return toRecord(item, fetchedAt);
  });
  const observations = records.map(
    (record, index) =>
      normalizeRadarObservation({
        source: "YOUTUBE_DATA_API",
        sourceItemId: record.sourceItemId,
        sourceUrl: record.sourceUrl,
        title: record.title,
        metricName: "MOST_POPULAR_CHART_RANK",
        scope: {
          countryCode: input.regionCode,
          queryKey: "mostPopular",
          dimensionsKey: `chart=mostPopular;region=${input.regionCode};category=${input.videoCategoryId ?? "all"}`,
        },
        window: { start: sampledAt, end: sampledAt, granularity: "SNAPSHOT" },
        sampledAt,
        sourceUpdatedAt: null,
        metric: { kind: "RANK", value: index + 1, comparisonKey: scope.key },
      }).observation,
  );
  return {
    fetchedAt,
    scope,
    nextPageAvailable: Boolean(parsed.data.nextPageToken),
    records,
    observations,
    completion: {
      status: observations.length ? "SUCCEEDED" : "EMPTY_VALID",
      pageCount: 1,
      observationCount: observations.length,
      truncated: false,
      missingCoverage: [],
      failureCode: null,
    },
  };
}
