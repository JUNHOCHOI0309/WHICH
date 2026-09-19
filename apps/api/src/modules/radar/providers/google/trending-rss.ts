import { createHash } from "node:crypto";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";

import type { RadarObservation } from "../../contracts.js";
import { normalizeRadarObservation } from "../../normalize.js";
import {
  classifyRadarHttpFailure,
  RadarIngestionFailure,
  type RadarCompletion,
} from "../../ingestion-service.js";

export const GOOGLE_TRENDING_RSS_ENDPOINT = "https://trends.google.com/trending/rss?geo=KR";
export const GOOGLE_TRENDING_RSS_LIMITS = Object.freeze({
  timeoutMilliseconds: 5_000,
  maxResponseBytes: 262_144,
  maxItems: 100,
  maxNestedTags: 16,
  maxFutureSkewMilliseconds: 10 * 60 * 1_000,
});

const allowedContentTypes = new Set(["application/rss+xml", "application/xml", "text/xml"]);
const timestamp = z.iso.datetime({ offset: true });
const rssItemSchema = z.object({
  title: z.string(),
  "ht:approx_traffic": z.string(),
  link: z.string(),
  pubDate: z.string(),
});
const rssFeedSchema = z.object({
  rss: z.object({
    channel: z.object({
      link: z.string(),
      item: z.array(rssItemSchema).default([]),
    }),
  }),
});
const bodyChunkSchema = z.object({
  done: z.boolean(),
  value: z.instanceof(Uint8Array).optional(),
});
const rfc2822 =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/u;
const trafficBand = /^(\d+(?:\.\d{1,3})?|\d{1,3}(?:,\d{3})+)([KMB])?\+$/iu;
const forbiddenDeclaration = /<!\s*(?:DOCTYPE|ENTITY)\b/iu;
const remainingEntity = /&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z_:][\w.:-]*);/u;

type RequestContext = {
  signal: AbortSignal;
  request<T>(
    operation: string,
    requestKey: string,
    perform: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GoogleTrendingRssRecord = {
  trafficLabel: string;
  observation: RadarObservation;
};

export type GoogleTrendingRssCollection = {
  fetchedAt: string;
  records: GoogleTrendingRssRecord[];
  completion: RadarCompletion;
};

type ParseOptions = {
  sampledAt: string;
  fetchedAt: string;
  maxItems?: number;
  maxResponseBytes?: number;
  maxFutureSkewMilliseconds?: number;
};

type CollectOptions = Omit<ParseOptions, "fetchedAt"> & {
  requestKey: string;
  fetchImpl?: FetchLike;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

function invalidResponse(): RadarIngestionFailure {
  return new RadarIngestionFailure("INVALID_RESPONSE", false);
}

function normalizedText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function decodeXmlText(value: string) {
  const decoded = value.replace(/&(?:amp|lt|gt|quot|apos|#[xX][0-9a-fA-F]+|#\d+);/gu, (entity) => {
    switch (entity) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default: {
        const hexadecimal = entity[2]?.toLowerCase() === "x";
        const digits = entity.slice(hexadecimal ? 3 : 2, -1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isInteger(codePoint) ||
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          throw invalidResponse();
        }
        return String.fromCodePoint(codePoint);
      }
    }
  });
  if (remainingEntity.test(decoded)) throw invalidResponse();
  return normalizedText(decoded);
}

export function parseGoogleTrafficLowerBound(label: string) {
  const normalized = normalizedText(label).toUpperCase();
  const match = trafficBand.exec(normalized);
  if (!match) throw invalidResponse();
  const numeric = Number(match[1]?.replaceAll(",", ""));
  const multiplier: number = {
    "": 1,
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
  }[match[2] ?? ""]!;
  const value = numeric * multiplier;
  if (!Number.isSafeInteger(value) || value < 0) throw invalidResponse();
  return { label: normalized, lowerBound: value };
}

function parsePublishedAt(value: string, fetchedAt: Date, maxFutureSkewMilliseconds: number) {
  const normalized = normalizedText(value);
  if (!rfc2822.test(normalized)) throw invalidResponse();
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getTime() > fetchedAt.getTime() + maxFutureSkewMilliseconds
  ) {
    throw invalidResponse();
  }
  return parsed.toISOString();
}

function sourceItemId(title: string, publishedAt: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify(["google-trending-rss-v1", "KR", title, publishedAt]))
    .digest("hex");
  return `google-rss-kr:${digest}`;
}

function assertFeedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(decodeXmlText(value));
  } catch (error) {
    if (error instanceof RadarIngestionFailure) throw error;
    throw invalidResponse();
  }
  if (url.href !== GOOGLE_TRENDING_RSS_ENDPOINT) throw invalidResponse();
}

export function parseGoogleTrendingRss(xml: string, options: ParseOptions) {
  const sampledAt = timestamp.parse(options.sampledAt);
  const fetchedAtString = timestamp.parse(options.fetchedAt);
  const fetchedAt = new Date(fetchedAtString);
  const maxItems = options.maxItems ?? GOOGLE_TRENDING_RSS_LIMITS.maxItems;
  const maxResponseBytes = options.maxResponseBytes ?? GOOGLE_TRENDING_RSS_LIMITS.maxResponseBytes;
  const maxFutureSkewMilliseconds =
    options.maxFutureSkewMilliseconds ?? GOOGLE_TRENDING_RSS_LIMITS.maxFutureSkewMilliseconds;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 500)
    throw new Error("INVALID_MAX_ITEMS");
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error("INVALID_GOOGLE_RSS_SIZE_LIMIT");
  }
  if (!Number.isInteger(maxFutureSkewMilliseconds) || maxFutureSkewMilliseconds < 0) {
    throw new Error("INVALID_FUTURE_SKEW");
  }
  if (forbiddenDeclaration.test(xml)) throw invalidResponse();
  if (Buffer.byteLength(xml, "utf8") > maxResponseBytes) throw invalidResponse();
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw invalidResponse();

  let raw: unknown;
  try {
    raw = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
      processEntities: false,
      maxNestedTags: GOOGLE_TRENDING_RSS_LIMITS.maxNestedTags,
      isArray: (_name, path) => path === "rss.channel.item",
    }).parse(xml);
  } catch {
    throw invalidResponse();
  }
  const feed = rssFeedSchema.safeParse(raw);
  if (!feed.success) throw invalidResponse();
  assertFeedUrl(feed.data.rss.channel.link);
  if (feed.data.rss.channel.item.length > maxItems) throw invalidResponse();

  const records = new Map<string, GoogleTrendingRssRecord>();
  for (const item of feed.data.rss.channel.item) {
    assertFeedUrl(item.link);
    const title = decodeXmlText(item.title);
    const traffic = parseGoogleTrafficLowerBound(decodeXmlText(item["ht:approx_traffic"]));
    const publishedAt = parsePublishedAt(item.pubDate, fetchedAt, maxFutureSkewMilliseconds);
    const id = sourceItemId(title, publishedAt);
    const observation = normalizeRadarObservation({
      source: "GOOGLE_TRENDING_RSS",
      sourceItemId: id,
      sourceUrl: GOOGLE_TRENDING_RSS_ENDPOINT,
      title,
      metricName: "APPROX_SEARCH_TRAFFIC_LOWER_BOUND",
      scope: {
        countryCode: "KR",
        queryKey: title,
        dimensionsKey: "feed=trending-now;geo=KR;traffic=approximate-lower-bound",
      },
      window: { start: publishedAt, end: publishedAt, granularity: "SNAPSHOT" },
      sampledAt,
      sourceUpdatedAt: publishedAt,
      metric: { kind: "LOWER_BOUND", value: traffic.lowerBound },
    }).observation;
    const previous = records.get(id);
    if (
      previous &&
      (previous.trafficLabel !== traffic.label ||
        previous.observation.metric.value !== observation.metric.value)
    ) {
      throw invalidResponse();
    }
    records.set(id, { trafficLabel: traffic.label, observation });
  }

  const values = [...records.values()];
  return {
    fetchedAt: fetchedAtString,
    records: values,
    completion: {
      status: values.length > 0 ? "SUCCEEDED" : "EMPTY_VALID",
      pageCount: 1,
      observationCount: values.length,
      truncated: false,
      missingCoverage: [],
      failureCode: null,
    },
  } satisfies GoogleTrendingRssCollection;
}

function retryAfterMilliseconds(value: string | null, at: Date) {
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Math.min(Number(value) * 1_000, 86_400_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - at.getTime());
}

async function readLimitedBody(response: Response, maxResponseBytes: number) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxResponseBytes)
  ) {
    throw invalidResponse();
  }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let xml = "";
  try {
    while (true) {
      const rawChunk: unknown = await reader.read();
      const { value, done } = bodyChunkSchema.parse(rawChunk);
      if (done) break;
      if (!value) throw invalidResponse();
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw invalidResponse();
      }
      xml += decoder.decode(value, { stream: true });
    }
    xml += decoder.decode();
  } catch (error) {
    if (error instanceof RadarIngestionFailure) throw error;
    throw invalidResponse();
  }
  if (!xml.trim()) throw invalidResponse();
  return xml;
}

export async function collectGoogleTrendingRss(
  context: RequestContext,
  options: CollectOptions,
): Promise<GoogleTrendingRssCollection> {
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? GOOGLE_TRENDING_RSS_LIMITS.timeoutMilliseconds;
  const maxResponseBytes = options.maxResponseBytes ?? GOOGLE_TRENDING_RSS_LIMITS.maxResponseBytes;
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error("INVALID_GOOGLE_RSS_TIMEOUT");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error("INVALID_GOOGLE_RSS_SIZE_LIMIT");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return context.request("trending.rss", options.requestKey, async (parentSignal) => {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) forwardAbort();
    else parentSignal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      timeoutMilliseconds,
    );
    try {
      if (controller.signal.aborted) throw new RadarIngestionFailure("TIMEOUT", true);
      const requestedAt = now();
      const response = await fetchImpl(GOOGLE_TRENDING_RSS_ENDPOINT, {
        method: "GET",
        headers: {
          accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "user-agent": "WHICH-Radar/1.0",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw classifyRadarHttpFailure(
          response.status,
          retryAfterMilliseconds(response.headers.get("retry-after"), requestedAt),
        );
      }
      if (response.redirected || (response.url && response.url !== GOOGLE_TRENDING_RSS_ENDPOINT)) {
        throw invalidResponse();
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !allowedContentTypes.has(contentType)) throw invalidResponse();
      const xml = await readLimitedBody(response, maxResponseBytes);
      const fetchedAt = now().toISOString();
      return parseGoogleTrendingRss(xml, { ...options, fetchedAt });
    } catch (error) {
      if (error instanceof RadarIngestionFailure) throw error;
      if (controller.signal.aborted) throw new RadarIngestionFailure("TIMEOUT", true);
      throw new RadarIngestionFailure("UPSTREAM", true);
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", forwardAbort);
    }
  });
}
