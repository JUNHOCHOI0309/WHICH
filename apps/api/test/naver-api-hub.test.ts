import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RadarIngestionFailure } from "../src/modules/radar/ingestion-service.js";
import {
  loadNaverApiHubCredentials,
  type NaverRequestContext,
} from "../src/modules/radar/providers/naver/common.js";
import {
  collectNaverNews,
  NAVER_NEWS_ENDPOINT,
} from "../src/modules/radar/providers/naver/news.js";
import {
  collectNaverSearchTrend,
  NAVER_SEARCH_TREND_ENDPOINT,
} from "../src/modules/radar/providers/naver/search-trend.js";

const sampledAt = "2026-09-19T23:59:00.000Z";
const fetchedAt = "2026-09-20T00:00:00.000Z";
const credentials = { clientId: "fixture-client-id", clientSecret: "fixture-client-secret" };
const groups = [
  { groupName: "한글", keywords: ["한글", "korean"] },
  { groupName: "영어", keywords: ["영어", "english"] },
];
let newsFixture = "";
let trendFixture = "";

function requestContext(signal = new AbortController().signal): NaverRequestContext {
  return {
    signal,
    request(operation, requestKey, perform) {
      expect(["news.search", "search.trend"]).toContain(operation);
      expect(requestKey).toMatch(/^[0-9a-zA-Z:_-]+$/u);
      return perform(signal);
    },
  };
}

type ResponseBody = ConstructorParameters<typeof Response>[0];
function response(body: ResponseBody, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(body, { ...init, headers });
}

const newsOptions = (overrides = {}) => ({
  query: "한글",
  display: 2,
  start: 1,
  sort: "date" as const,
  sampledAt,
  requestKey: "news:attempt1:page1",
  credentials,
  now: () => new Date(fetchedAt),
  fetchImpl: () => Promise.resolve(response(newsFixture)),
  ...overrides,
});

const trendOptions = (overrides = {}) => ({
  startDate: "2026-09-17",
  endDate: "2026-09-19",
  timeUnit: "date" as const,
  keywordGroups: groups,
  sampledAt,
  requestKey: "trend:attempt1:page1",
  credentials,
  now: () => new Date(fetchedAt),
  fetchImpl: () => Promise.resolve(response(trendFixture)),
  ...overrides,
});

newsFixture = await readFile(new URL("./fixtures/radar/naver-news.json", import.meta.url), "utf8");
trendFixture = await readFile(
  new URL("./fixtures/radar/naver-search-trend.json", import.meta.url),
  "utf8",
);

describe("NAVER API HUB credentials and HTTP boundary", () => {
  it("loads credentials only from the server environment and fails closed", () => {
    expect(
      loadNaverApiHubCredentials({
        NAVER_API_HUB_CLIENT_ID: credentials.clientId,
        NAVER_API_HUB_CLIENT_SECRET: credentials.clientSecret,
      }),
    ).toEqual(credentials);
    for (const environment of [
      {},
      { NAVER_API_HUB_CLIENT_ID: "id" },
      { NAVER_API_HUB_CLIENT_ID: "id\nleak", NAVER_API_HUB_CLIENT_SECRET: "secret" },
    ]) {
      expect(() => loadNaverApiHubCredentials(environment)).toThrow(RadarIngestionFailure);
    }
  });

  it("sends Hub-only auth headers without returning credentials", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    const result = await collectNaverNews(
      requestContext(),
      newsOptions({
        fetchImpl: (input: string, request: RequestInit) => {
          requested = input;
          init = request;
          return Promise.resolve(response(newsFixture));
        },
      }),
    );
    const url = new URL(requested);
    expect(`${url.origin}${url.pathname}`).toBe(NAVER_NEWS_ENDPOINT);
    expect(url.searchParams.get("query")).toBe("한글");
    expect(url.searchParams.get("format")).toBe("json");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-ncp-apigw-api-key-id")).toBe(credentials.clientId);
    expect(headers.get("x-ncp-apigw-api-key")).toBe(credentials.clientSecret);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(JSON.stringify(result)).not.toContain(credentials.clientSecret);
  });

  it.each([
    [401, "AUTH", false, {}],
    [403, "AUTH", false, {}],
    [429, "RATE_LIMIT", true, { "retry-after": "2" }],
    [503, "UPSTREAM", true, {}],
    [302, "INVALID_RESPONSE", false, { location: "https://evil.example/" }],
  ])(
    "classifies HTTP %s without exposing the provider body",
    async (status, code, retryable, headers) => {
      await expect(
        collectNaverNews(
          requestContext(),
          newsOptions({
            fetchImpl: () =>
              Promise.resolve(
                response(JSON.stringify({ secret: "provider-body" }), { status, headers }),
              ),
          }),
        ),
      ).rejects.toMatchObject({ failureCode: code, retryable });
    },
  );

  it("rejects wrong content type, oversized streams and slow requests", async () => {
    await expect(
      collectNaverNews(
        requestContext(),
        newsOptions({
          fetchImpl: () =>
            Promise.resolve(response(newsFixture, { headers: { "content-type": "text/html" } })),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE", retryable: false });
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200));
        controller.enqueue(new Uint8Array(200));
        controller.close();
      },
    });
    await expect(
      collectNaverNews(
        requestContext(),
        newsOptions({
          maxResponseBytes: 256,
          fetchImpl: () => Promise.resolve(response(oversized)),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE", retryable: false });
    await expect(
      collectNaverNews(
        requestContext(),
        newsOptions({
          timeoutMilliseconds: 10,
          fetchImpl: (_input: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            }),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "TIMEOUT", retryable: true });
  });

  it("does not call the provider after the run is aborted and normalizes network failures", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      collectNaverNews(
        requestContext(controller.signal),
        newsOptions({
          fetchImpl: () => {
            called = true;
            return Promise.resolve(response(newsFixture));
          },
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "TIMEOUT", retryable: true });
    expect(called).toBe(false);
    await expect(
      collectNaverNews(
        requestContext(),
        newsOptions({
          fetchImpl: () => Promise.reject(new Error("secret provider URL must not escape")),
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ failureCode: "UPSTREAM", retryable: true }));
  });
});

describe("NAVER news search adapter", () => {
  it("keeps related-news records separate from trend observations", async () => {
    const result = await collectNaverNews(requestContext(), newsOptions());
    expect(result).toMatchObject({
      query: "한글",
      fetchedAt,
      sourceUpdatedAt: "2026-09-19T23:00:00.000Z",
      totalResults: 2,
      completion: { status: "SUCCEEDED", pageCount: 1, observationCount: 2 },
    });
    expect(result.records).toEqual([
      expect.objectContaining({
        query: "한글",
        title: "한글 & English 뉴스",
        description: "검색어의 새 소식을 전합니다.",
        sourceUrl: "https://n.news.naver.com/article/001/0000000001",
        originalUrl: "https://news.example.com/articles/1",
        publishedAt: "2026-09-19T22:50:00.000Z",
        observedAt: fetchedAt,
      }),
      expect.objectContaining({ originalUrl: "http://news.example.net/articles/2" }),
    ]);
    expect(result.records[0]).not.toHaveProperty("metric");
  });

  it("treats a valid empty page separately from invalid markup and timestamps", async () => {
    const empty = JSON.stringify({
      lastBuildDate: "Sun, 20 Sep 2026 08:00:00 +0900",
      total: 0,
      start: 1,
      display: 2,
      items: [],
    });
    await expect(
      collectNaverNews(
        requestContext(),
        newsOptions({ fetchImpl: () => Promise.resolve(response(empty)) }),
      ),
    ).resolves.toMatchObject({ records: [], completion: { status: "EMPTY_VALID" } });
    for (const invalid of [
      newsFixture.replace("<b>한글</b>", "<script>한글</script>"),
      newsFixture.replace("Sun, 20 Sep 2026 07:50:00 +0900", "tomorrow"),
      newsFixture.replace('"display": 2', '"display": 1'),
    ]) {
      await expect(
        collectNaverNews(
          requestContext(),
          newsOptions({ fetchImpl: () => Promise.resolve(response(invalid)) }),
        ),
      ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE" });
    }
  });
});

describe("NAVER search trend adapter", () => {
  it("preserves the full comparison cohort and daily relative-index meaning", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    const result = await collectNaverSearchTrend(
      requestContext(),
      trendOptions({
        device: "mo",
        ages: ["3", "4"],
        fetchImpl: (input: string, request: RequestInit) => {
          requested = input;
          init = request;
          return Promise.resolve(response(trendFixture));
        },
      }),
    );
    expect(requested).toBe(NAVER_SEARCH_TREND_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toEqual({
      startDate: "2026-09-17",
      endDate: "2026-09-19",
      timeUnit: "date",
      keywordGroups: groups,
      device: "mo",
      ages: ["3", "4"],
    });
    expect(result.comparison).toMatchObject({
      keywordGroups: groups,
      device: "mo",
      gender: null,
      ages: ["3", "4"],
      maximumMeaning: "MAXIMUM_WITHIN_THIS_REQUEST_EQUALS_100",
    });
    expect(result.observations).toHaveLength(6);
    expect(result.observations[0]).toMatchObject({
      source: "NAVER_DATALAB",
      title: "한글",
      sourceUpdatedAt: null,
      window: {
        start: "2026-09-16T15:00:00.000Z",
        end: "2026-09-17T14:59:59.999Z",
        granularity: "DAY",
      },
      metric: {
        kind: "RELATIVE_INDEX",
        value: 50,
        comparisonKey: result.comparison.key,
      },
    });
    expect(Math.max(...result.observations.map((item) => item.metric.value ?? 0))).toBe(100);
    expect(result.completion).toMatchObject({ status: "SUCCEEDED", observationCount: 6 });
  });

  it("accepts a provider-confirmed empty result without fabricating zeroes", async () => {
    const empty = JSON.stringify({
      startDate: "2026-09-17",
      endDate: "2026-09-19",
      timeUnit: "date",
      results: [],
    });
    await expect(
      collectNaverSearchTrend(
        requestContext(),
        trendOptions({ fetchImpl: () => Promise.resolve(response(empty)) }),
      ),
    ).resolves.toMatchObject({
      observations: [],
      comparison: { keywordGroups: groups },
      completion: { status: "EMPTY_VALID", observationCount: 0 },
    });
  });

  it("rejects changed cohorts, duplicate periods and ratios without a request-wide 100", async () => {
    const changedCohort = trendFixture.replace('"korean"', '"korean-news"');
    const duplicatePeriod = trendFixture.replace(
      '"2026-09-19", "ratio": 80.25',
      '"2026-09-18", "ratio": 80.25',
    );
    const missingMaximum = trendFixture.replace('"ratio": 100', '"ratio": 99');
    for (const invalid of [changedCohort, duplicatePeriod, missingMaximum]) {
      await expect(
        collectNaverSearchTrend(
          requestContext(),
          trendOptions({ fetchImpl: () => Promise.resolve(response(invalid)) }),
        ),
      ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE", retryable: false });
    }
  });

  it("rejects ambiguous or oversized request cohorts before fetch", async () => {
    let called = false;
    for (const keywordGroups of [
      [groups[0], groups[0]],
      [{ groupName: "한글", keywords: ["한글", "한글"] }],
      [{ groupName: "한글", keywords: ["1", "2", "3", "4", "5", "6"] }],
    ]) {
      await expect(
        collectNaverSearchTrend(
          requestContext(),
          trendOptions({
            keywordGroups,
            fetchImpl: () => {
              called = true;
              return Promise.resolve(response(trendFixture));
            },
          }),
        ),
      ).rejects.toThrow();
    }
    expect(called).toBe(false);
  });
});

const smoke = process.env.RADAR_NAVER_API_HUB_SMOKE === "1" ? it : it.skip;
smoke(
  "reads approved NAVER API HUB news and search-trend endpoints without persisting",
  async () => {
    const now = new Date();
    const end = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() - 86_400_000));
    const start = new Date(`${end}T00:00:00+09:00`);
    start.setUTCDate(start.getUTCDate() - 6);
    const startDate = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(start);
    const context = requestContext();
    const news = await collectNaverNews(context, {
      query: "네이버",
      display: 2,
      start: 1,
      sort: "date",
      sampledAt: now.toISOString(),
      requestKey: "smoke:news",
    });
    const trend = await collectNaverSearchTrend(context, {
      startDate,
      endDate: end,
      keywordGroups: [{ groupName: "네이버", keywords: ["네이버"] }],
      sampledAt: now.toISOString(),
      requestKey: "smoke:trend",
    });
    expect(news.completion.pageCount).toBe(1);
    expect(trend.completion.pageCount).toBe(1);
  },
  30_000,
);
