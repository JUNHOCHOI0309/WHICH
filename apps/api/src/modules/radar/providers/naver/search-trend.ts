import { createHash } from "node:crypto";

import { z } from "zod";

import type { RadarObservation } from "../../contracts.js";
import type { RadarCompletion } from "../../ingestion-service.js";
import { normalizeRadarObservation } from "../../normalize.js";
import {
  invalidNaverResponse,
  NAVER_API_HUB_ORIGIN,
  requestNaverApiHubJson,
  type NaverApiHubCredentials,
  type NaverFetch,
  type NaverRequestContext,
} from "./common.js";

export const NAVER_SEARCH_TREND_ENDPOINT = `${NAVER_API_HUB_ORIGIN}/search-trend/v1/search`;

const timestamp = z.iso.datetime({ offset: true });
const keyword = z.string().trim().min(1).max(100);
const keywordGroup = z.strictObject({
  groupName: z.string().trim().min(1).max(100),
  // Current API reference says 20, while the API HUB overview says 5.
  // Use the stricter limit until NAVER aligns the documents.
  keywords: z.array(keyword).min(1).max(5),
});
const requestSchema = z.strictObject({
  startDate: z.iso.date().refine((value) => value >= "2016-01-01"),
  endDate: z.iso.date(),
  timeUnit: z.literal("date").default("date"),
  keywordGroups: z.array(keywordGroup).min(1).max(5),
  device: z.enum(["pc", "mo"]).optional(),
  gender: z.enum(["m", "f"]).optional(),
  ages: z
    .array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]))
    .min(1)
    .max(11)
    .optional(),
});
const responseSchema = z.strictObject({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  timeUnit: z.literal("date"),
  results: z
    .array(
      z.strictObject({
        title: z.string().max(500),
        keywords: z.array(z.string().max(500)).max(20),
        data: z
          .array(
            z.strictObject({
              period: z.iso.date(),
              ratio: z.number().finite().min(0).max(100),
            }),
          )
          .max(4_000),
      }),
    )
    .max(5),
});

export type NaverSearchTrendComparison = {
  key: string;
  startDate: string;
  endDate: string;
  timeUnit: "date";
  keywordGroups: Array<{ groupName: string; keywords: string[] }>;
  device: "pc" | "mo" | null;
  gender: "m" | "f" | null;
  ages: string[];
  maximumMeaning: "MAXIMUM_WITHIN_THIS_REQUEST_EQUALS_100";
};

export type NaverSearchTrendCollection = {
  fetchedAt: string;
  comparison: NaverSearchTrendComparison;
  observations: RadarObservation[];
  completion: RadarCompletion;
};

type Options = z.input<typeof requestSchema> & {
  sampledAt: string;
  requestKey: string;
  credentials?: NaverApiHubCredentials;
  fetchImpl?: NaverFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

function normalizedText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function normalizedRequest(input: z.output<typeof requestSchema>) {
  const keywordGroups = input.keywordGroups.map((group) => ({
    groupName: normalizedText(group.groupName),
    keywords: group.keywords.map(normalizedText),
  }));
  if (
    new Set(keywordGroups.map((group) => group.groupName)).size !== keywordGroups.length ||
    keywordGroups.some(
      (group) => new Set(group.keywords).size !== group.keywords.length || !group.groupName,
    ) ||
    (input.ages && new Set(input.ages).size !== input.ages.length) ||
    input.startDate > input.endDate
  ) {
    throw new Error("INVALID_NAVER_TREND_REQUEST");
  }
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    timeUnit: "date" as const,
    keywordGroups,
    ...(input.device ? { device: input.device } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.ages ? { ages: [...input.ages] } : {}),
  };
}

function comparisonFor(input: ReturnType<typeof normalizedRequest>) {
  const payload = {
    startDate: input.startDate,
    endDate: input.endDate,
    timeUnit: input.timeUnit,
    keywordGroups: input.keywordGroups,
    device: input.device ?? null,
    gender: input.gender ?? null,
    ages: input.ages ?? [],
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(["naver-api-hub-search-trend-v1", payload]))
    .digest("hex");
  return {
    key: `naver-search-trend:${digest}`,
    ...payload,
    maximumMeaning: "MAXIMUM_WITHIN_THIS_REQUEST_EQUALS_100" as const,
  };
}

function dayWindow(period: string) {
  const start = new Date(`${period}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) throw invalidNaverResponse();
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000 - 1).toISOString(),
  };
}

function sourceItemId(comparisonKey: string, groupName: string, period: string) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify(["naver-api-hub-search-trend-item-v1", comparisonKey, groupName, period]),
    )
    .digest("hex");
  return `naver-trend:${digest}`;
}

export async function collectNaverSearchTrend(
  context: NaverRequestContext,
  options: Options,
): Promise<NaverSearchTrendCollection> {
  const sampledAt = timestamp.parse(options.sampledAt);
  const request = normalizedRequest(
    requestSchema.parse({
      startDate: options.startDate,
      endDate: options.endDate,
      timeUnit: options.timeUnit,
      keywordGroups: options.keywordGroups,
      device: options.device,
      gender: options.gender,
      ages: options.ages,
    }),
  );
  const comparison = comparisonFor(request);
  const { payload, fetchedAt } = await requestNaverApiHubJson({
    context,
    operation: "search.trend",
    requestKey: options.requestKey,
    url: NAVER_SEARCH_TREND_ENDPOINT,
    method: "POST",
    body: JSON.stringify(request),
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
    response.startDate !== request.startDate ||
    response.endDate !== request.endDate ||
    response.timeUnit !== request.timeUnit
  ) {
    throw invalidNaverResponse();
  }
  if (response.results.length !== 0 && response.results.length !== request.keywordGroups.length) {
    throw invalidNaverResponse();
  }
  if (response.results.reduce((total, result) => total + result.data.length, 0) > 10_000) {
    throw invalidNaverResponse();
  }

  const byTitle = new Map(response.results.map((result) => [normalizedText(result.title), result]));
  if (byTitle.size !== response.results.length) throw invalidNaverResponse();
  const observations: RadarObservation[] = [];
  const ratios: number[] = [];
  for (const group of request.keywordGroups) {
    const result = byTitle.get(group.groupName);
    if (!result) {
      if (response.results.length === 0) continue;
      throw invalidNaverResponse();
    }
    if (
      result.keywords.length !== group.keywords.length ||
      result.keywords.some((value, index) => normalizedText(value) !== group.keywords[index])
    ) {
      throw invalidNaverResponse();
    }
    const periods = new Set<string>();
    for (const point of [...result.data].sort((a, b) => a.period.localeCompare(b.period))) {
      if (
        point.period < request.startDate ||
        point.period > request.endDate ||
        periods.has(point.period)
      ) {
        throw invalidNaverResponse();
      }
      periods.add(point.period);
      ratios.push(point.ratio);
      const window = dayWindow(point.period);
      observations.push(
        normalizeRadarObservation({
          source: "NAVER_DATALAB",
          sourceItemId: sourceItemId(comparison.key, group.groupName, point.period),
          sourceUrl: NAVER_SEARCH_TREND_ENDPOINT,
          title: group.groupName,
          metricName: "SEARCH_INTEREST_RELATIVE_INDEX",
          scope: {
            countryCode: "KR",
            queryKey: group.groupName,
            dimensionsKey: `geo=KR;timeUnit=date;cohort=${comparison.key.slice(-64)}`,
          },
          window: { ...window, granularity: "DAY" },
          sampledAt,
          sourceUpdatedAt: null,
          metric: {
            kind: "RELATIVE_INDEX",
            value: point.ratio,
            comparisonKey: comparison.key,
          },
        }).observation,
      );
    }
  }
  if (ratios.some((ratio) => ratio > 0) && Math.max(...ratios) !== 100) {
    throw invalidNaverResponse();
  }
  return {
    fetchedAt,
    comparison,
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
