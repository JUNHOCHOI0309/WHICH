import { createHash } from "node:crypto";

import { z } from "zod";

import type { RadarCompletion } from "../../ingestion-service.js";
import {
  invalidYouTubeResponse,
  requestYouTubeDataApiJson,
  type YouTubeDataApiCredentials,
  type YouTubeFetch,
  type YouTubeRequestContext,
} from "./common.js";

export const YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";

const timestamp = z.iso.datetime({ offset: true });
const inputSchema = z.strictObject({
  query: z.string().trim().min(1).max(100),
  maxResults: z.number().int().min(1).max(50).default(25),
  order: z
    .enum(["date", "rating", "relevance", "title", "videoCount", "viewCount"])
    .default("relevance"),
  regionCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("KR"),
  relevanceLanguage: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
    .default("ko"),
  publishedAfter: timestamp.optional(),
  publishedBefore: timestamp.optional(),
});
const responseSchema = z.object({
  nextPageToken: z.string().min(1).max(1_000).optional(),
  pageInfo: z
    .object({
      totalResults: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      resultsPerPage: z.number().int().nonnegative().max(50),
    })
    .optional(),
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().regex(/^[0-9A-Za-z_-]{11}$/) }),
        snippet: z.object({
          publishedAt: timestamp,
          channelId: z.string().trim().min(1).max(100),
          title: z.string().max(4_000),
          channelTitle: z.string().max(500),
        }),
      }),
    )
    .max(50),
});

export type YouTubeSearchScope = {
  key: string;
  query: string;
  order: z.infer<typeof inputSchema>["order"];
  regionCode: string;
  relevanceLanguage: string;
  publishedAfter: string | null;
  publishedBefore: string | null;
  resultLimit: number;
  meaning: "RANK_WITHIN_THIS_BOUNDED_SEARCH_RESPONSE_NOT_A_YOUTUBE_CHART";
};

export type YouTubeSearchRecord = {
  sourceItemId: string;
  videoId: string;
  sourceUrl: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  observedAt: string;
  rankWithinResponse: number;
  searchScopeKey: string;
};

export type YouTubeSearchCollection = {
  fetchedAt: string;
  scope: YouTubeSearchScope;
  approximateTotalResults: number | null;
  nextPageAvailable: boolean;
  records: YouTubeSearchRecord[];
  completion: RadarCompletion;
};

type Options = z.input<typeof inputSchema> & {
  requestKey: string;
  credentials?: YouTubeDataApiCredentials;
  fetchImpl?: YouTubeFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

function normalizedText(value: string, maximumLength: number) {
  const result = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!result || result.length > maximumLength) throw invalidYouTubeResponse();
  return result;
}

function scopeFor(input: z.output<typeof inputSchema>): YouTubeSearchScope {
  const payload = {
    query: input.query.normalize("NFC").replace(/\s+/gu, " ").trim(),
    order: input.order,
    regionCode: input.regionCode,
    relevanceLanguage: input.relevanceLanguage,
    publishedAfter: input.publishedAfter ?? null,
    publishedBefore: input.publishedBefore ?? null,
    resultLimit: input.maxResults,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(["youtube-search-scope-v1", payload]))
    .digest("hex");
  return {
    key: `youtube-search:${digest}`,
    ...payload,
    meaning: "RANK_WITHIN_THIS_BOUNDED_SEARCH_RESPONSE_NOT_A_YOUTUBE_CHART",
  };
}

export async function searchYouTubeVideos(
  context: YouTubeRequestContext,
  options: Options,
): Promise<YouTubeSearchCollection> {
  const input = inputSchema.parse({
    query: options.query,
    maxResults: options.maxResults,
    order: options.order,
    regionCode: options.regionCode,
    relevanceLanguage: options.relevanceLanguage,
    publishedAfter: options.publishedAfter,
    publishedBefore: options.publishedBefore,
  });
  if (
    input.publishedAfter &&
    input.publishedBefore &&
    Date.parse(input.publishedAfter) > Date.parse(input.publishedBefore)
  ) {
    throw new Error("INVALID_YOUTUBE_SEARCH_WINDOW");
  }
  const scope = scopeFor(input);
  const parameters: Record<string, string> = {
    part: "snippet",
    type: "video",
    q: scope.query,
    maxResults: String(input.maxResults),
    order: input.order,
    regionCode: input.regionCode,
    relevanceLanguage: input.relevanceLanguage,
    fields:
      "nextPageToken,pageInfo(totalResults,resultsPerPage),items(id/videoId,snippet(publishedAt,channelId,title,channelTitle))",
  };
  if (input.publishedAfter) parameters.publishedAfter = input.publishedAfter;
  if (input.publishedBefore) parameters.publishedBefore = input.publishedBefore;

  const { payload, fetchedAt } = await requestYouTubeDataApiJson({
    context,
    operation: "search.list",
    requestKey: options.requestKey,
    path: "/youtube/v3/search",
    parameters,
    credentials: options.credentials,
    fetchImpl: options.fetchImpl,
    timeoutMilliseconds: options.timeoutMilliseconds,
    maxResponseBytes: options.maxResponseBytes,
    now: options.now,
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw invalidYouTubeResponse();
  const response = parsed.data;
  if (
    response.items.length > input.maxResults ||
    (response.pageInfo && response.pageInfo.resultsPerPage < response.items.length)
  ) {
    throw invalidYouTubeResponse();
  }

  const records = new Map<string, YouTubeSearchRecord>();
  for (const [index, item] of response.items.entries()) {
    const record: YouTubeSearchRecord = {
      sourceItemId: `youtube-video:${item.id.videoId}`,
      videoId: item.id.videoId,
      sourceUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      title: normalizedText(item.snippet.title, 500),
      channelId: normalizedText(item.snippet.channelId, 100),
      channelTitle: normalizedText(item.snippet.channelTitle, 500),
      publishedAt: item.snippet.publishedAt,
      observedAt: fetchedAt,
      rankWithinResponse: index + 1,
      searchScopeKey: scope.key,
    };
    const previous = records.get(record.videoId);
    if (previous) {
      const comparable = { ...record, rankWithinResponse: previous.rankWithinResponse };
      if (JSON.stringify(previous) !== JSON.stringify(comparable)) throw invalidYouTubeResponse();
      continue;
    }
    records.set(record.videoId, record);
  }
  const values = [...records.values()];
  return {
    fetchedAt,
    scope,
    approximateTotalResults: response.pageInfo?.totalResults ?? null,
    nextPageAvailable: Boolean(response.nextPageToken),
    records: values,
    completion: {
      status: values.length ? "SUCCEEDED" : "EMPTY_VALID",
      pageCount: 1,
      observationCount: values.length,
      truncated: false,
      missingCoverage: [],
      failureCode: null,
    },
  };
}
