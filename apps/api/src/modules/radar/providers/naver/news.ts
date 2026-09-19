import { createHash } from "node:crypto";

import { z } from "zod";

import type { RadarCompletion } from "../../ingestion-service.js";
import {
  invalidNaverResponse,
  NAVER_API_HUB_ORIGIN,
  requestNaverApiHubJson,
  type NaverApiHubCredentials,
  type NaverFetch,
  type NaverRequestContext,
} from "./common.js";

export const NAVER_NEWS_ENDPOINT = `${NAVER_API_HUB_ORIGIN}/search/v1/news`;

const timestamp = z.iso.datetime({ offset: true });
const inputSchema = z.strictObject({
  query: z.string().trim().min(1).max(100),
  display: z.number().int().min(1).max(100).default(10),
  start: z.number().int().min(1).max(1_000).default(1),
  sort: z.enum(["sim", "date"]).default("date"),
});
const itemSchema = z.strictObject({
  title: z.string().max(4_000),
  originallink: z.string().max(8_192),
  link: z.string().max(8_192),
  description: z.string().max(16_000),
  pubDate: z.string().max(100),
});
const responseSchema = z.strictObject({
  lastBuildDate: z.string().max(100),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  start: z.number().int().min(1).max(1_000),
  display: z.number().int().min(1).max(100),
  items: z.array(itemSchema).max(100),
});
const rfc2822 =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/u;

export type NaverNewsRecord = {
  sourceItemId: string;
  query: string;
  title: string;
  description: string;
  sourceUrl: string;
  originalUrl: string;
  publishedAt: string;
  observedAt: string;
};

export type NaverNewsCollection = {
  query: string;
  fetchedAt: string;
  sourceUpdatedAt: string;
  totalResults: number;
  records: NaverNewsRecord[];
  completion: RadarCompletion;
};

type Options = z.input<typeof inputSchema> & {
  sampledAt: string;
  requestKey: string;
  credentials?: NaverApiHubCredentials;
  fetchImpl?: NaverFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  maxFutureSkewMilliseconds?: number;
  now?: () => Date;
};

function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function decodeEntities(value: string) {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39|#[xX][0-9a-fA-F]+|#\d+);/gu,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
        "&#39;": "'",
      };
      if (named[entity] !== undefined) return named[entity];
      const hexadecimal = entity[2]?.toLowerCase() === "x";
      const digits = entity.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        throw invalidNaverResponse();
      }
      return String.fromCodePoint(codePoint);
    },
  );
  if (/&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z_:][\w.:-]*);/u.test(decoded)) {
    throw invalidNaverResponse();
  }
  return normalizeText(decoded);
}

function cleanHighlightedText(value: string, maximumLength: number, allowEmpty = false) {
  const withoutHighlights = value.replace(/<\/?b>/giu, "");
  if (/<[^>]*>/u.test(withoutHighlights)) throw invalidNaverResponse();
  const normalized = decodeEntities(withoutHighlights);
  if ((!allowEmpty && !normalized) || normalized.length > maximumLength) {
    throw invalidNaverResponse();
  }
  return normalized;
}

function safeArticleUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidNaverResponse();
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw invalidNaverResponse();
  }
  url.hash = "";
  return url.href;
}

function parseProviderTime(value: string, fetchedAt: Date, maxFutureSkewMilliseconds: number) {
  const normalized = normalizeText(value);
  if (!rfc2822.test(normalized)) throw invalidNaverResponse();
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getTime() > fetchedAt.getTime() + maxFutureSkewMilliseconds
  ) {
    throw invalidNaverResponse();
  }
  return parsed.toISOString();
}

function sourceItemId(query: string, sourceUrl: string, publishedAt: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify(["naver-api-hub-news-v1", query, sourceUrl, publishedAt]))
    .digest("hex");
  return `naver-news:${digest}`;
}

export async function collectNaverNews(
  context: NaverRequestContext,
  options: Options,
): Promise<NaverNewsCollection> {
  const input = inputSchema.parse({
    query: options.query,
    display: options.display,
    start: options.start,
    sort: options.sort,
  });
  timestamp.parse(options.sampledAt);
  const maxFutureSkewMilliseconds = options.maxFutureSkewMilliseconds ?? 10 * 60 * 1_000;
  if (!Number.isInteger(maxFutureSkewMilliseconds) || maxFutureSkewMilliseconds < 0) {
    throw new Error("INVALID_FUTURE_SKEW");
  }
  const url = new URL(NAVER_NEWS_ENDPOINT);
  url.searchParams.set("query", input.query);
  url.searchParams.set("display", String(input.display));
  url.searchParams.set("start", String(input.start));
  url.searchParams.set("sort", input.sort);
  url.searchParams.set("format", "json");

  const { payload, fetchedAt } = await requestNaverApiHubJson({
    context,
    operation: "news.search",
    requestKey: options.requestKey,
    url: url.href,
    method: "GET",
    credentials: options.credentials,
    fetchImpl: options.fetchImpl,
    timeoutMilliseconds: options.timeoutMilliseconds,
    maxResponseBytes: options.maxResponseBytes,
    now: options.now,
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw invalidNaverResponse();
  const response = parsed.data;
  if (
    response.start !== input.start ||
    response.display !== input.display ||
    response.items.length > response.display ||
    response.items.length > response.total
  ) {
    throw invalidNaverResponse();
  }
  const fetched = new Date(fetchedAt);
  const sourceUpdatedAt = parseProviderTime(
    response.lastBuildDate,
    fetched,
    maxFutureSkewMilliseconds,
  );
  const records = new Map<string, NaverNewsRecord>();
  for (const item of response.items) {
    const sourceUrl = safeArticleUrl(item.link);
    const originalUrl = safeArticleUrl(item.originallink);
    const publishedAt = parseProviderTime(item.pubDate, fetched, maxFutureSkewMilliseconds);
    const record: NaverNewsRecord = {
      sourceItemId: sourceItemId(input.query, sourceUrl, publishedAt),
      query: input.query,
      title: cleanHighlightedText(item.title, 500),
      description: cleanHighlightedText(item.description, 2_000, true),
      sourceUrl,
      originalUrl,
      publishedAt,
      observedAt: fetchedAt,
    };
    const previous = records.get(record.sourceItemId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw invalidNaverResponse();
    }
    records.set(record.sourceItemId, record);
  }
  const values = [...records.values()];
  return {
    query: input.query,
    fetchedAt,
    sourceUpdatedAt,
    totalResults: response.total,
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
