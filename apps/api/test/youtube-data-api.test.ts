import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RadarIngestionFailure } from "../src/modules/radar/ingestion-service.js";
import {
  defaultRadarActivation,
  evaluateRadarStoredUse,
} from "../src/modules/radar/source-policy.js";
import {
  loadYouTubeDataApiCredentials,
  type YouTubeRequestContext,
} from "../src/modules/radar/providers/youtube/common.js";
import {
  searchYouTubeVideos,
  YOUTUBE_SEARCH_ENDPOINT,
} from "../src/modules/radar/providers/youtube/search.js";
import {
  collectYouTubeMostPopularChart,
  collectYouTubeVideoStatistics,
  YOUTUBE_VIDEOS_ENDPOINT,
} from "../src/modules/radar/providers/youtube/videos.js";

const sampledAt = "2026-09-20T01:00:00.000Z";
const fetchedAt = "2026-09-20T01:00:01.000Z";
const credentials = { apiKey: "fixture-api-key" };
const thirdVideoId = "StUvWxYzA03";
let searchFixture = "";
let videosFixture = "";
let chartFixture = "";

function requestContext(signal = new AbortController().signal): YouTubeRequestContext {
  return {
    signal,
    request(operation, requestKey, perform) {
      expect(["search.list", "videos.list"]).toContain(operation);
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

const searchOptions = (overrides = {}) => ({
  query: "실시간 트렌드",
  maxResults: 2,
  order: "relevance" as const,
  regionCode: "KR",
  relevanceLanguage: "ko",
  requestKey: "youtube:search:attempt1:page1",
  credentials,
  now: () => new Date(fetchedAt),
  fetchImpl: () => Promise.resolve(response(searchFixture)),
  ...overrides,
});

const statisticsOptions = (overrides = {}) => ({
  videoIds: ["AbCdEfGhI01", "AbCdEfGhI01", "JkLmNoPqR02", thirdVideoId],
  sampledAt,
  requestKey: "youtube:videos:attempt1:batch1",
  credentials,
  now: () => new Date(fetchedAt),
  fetchImpl: () => Promise.resolve(response(videosFixture)),
  ...overrides,
});

const chartOptions = (overrides = {}) => ({
  regionCode: "KR",
  videoCategoryId: "20",
  maxResults: 2,
  sampledAt,
  requestKey: "youtube:chart:attempt1:page1",
  credentials,
  now: () => new Date(fetchedAt),
  fetchImpl: () => Promise.resolve(response(chartFixture)),
  ...overrides,
});

searchFixture = await readFile(
  new URL("./fixtures/radar/youtube-search.json", import.meta.url),
  "utf8",
);
videosFixture = await readFile(
  new URL("./fixtures/radar/youtube-videos.json", import.meta.url),
  "utf8",
);
chartFixture = await readFile(
  new URL("./fixtures/radar/youtube-most-popular.json", import.meta.url),
  "utf8",
);

describe("YouTube Data API credentials and HTTP boundary", () => {
  it("keeps long-term storage and derived use closed without separate approval", () => {
    const activation = defaultRadarActivation("YOUTUBE_DATA_API");
    expect(activation).toMatchObject({
      enabled: false,
      killSwitch: true,
      retentionHours: null,
      rights: { derive: { status: "UNKNOWN" } },
    });
    expect(
      evaluateRadarStoredUse(activation, "derive", "2026-09-20T00:00:00Z", "2026-09-20T01:00:00Z")
        .allowed,
    ).toBe(false);
  });

  it("loads only a server-side API key and fails closed", () => {
    expect(loadYouTubeDataApiCredentials({ YOUTUBE_DATA_API_KEY: credentials.apiKey })).toEqual(
      credentials,
    );
    for (const environment of [
      {},
      { YOUTUBE_DATA_API_KEY: " key" },
      { YOUTUBE_DATA_API_KEY: "x\ny" },
    ]) {
      expect(() => loadYouTubeDataApiCredentials(environment)).toThrow(RadarIngestionFailure);
    }
  });

  it("uses the fixed HTTPS search endpoint without exposing the key in results", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    const result = await searchYouTubeVideos(
      requestContext(),
      searchOptions({
        fetchImpl: (input: string, request: RequestInit) => {
          requested = input;
          init = request;
          return Promise.resolve(response(searchFixture));
        },
      }),
    );
    const url = new URL(requested);
    expect(`${url.origin}${url.pathname}`).toBe(YOUTUBE_SEARCH_ENDPOINT);
    expect(url.searchParams.get("key")).toBe(credentials.apiKey);
    expect(url.searchParams.get("type")).toBe("video");
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
  });

  it.each([
    [403, { error: { errors: [{ reason: "quotaExceeded" }] } }, "RATE_LIMIT", false],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "RATE_LIMIT", true],
    [403, { error: { errors: [{ reason: "keyInvalid" }] } }, "AUTH", false],
    [429, { error: { errors: [] } }, "RATE_LIMIT", true],
    [503, { error: { errors: [] } }, "UPSTREAM", true],
  ])(
    "classifies HTTP %s provider failures without returning the body",
    async (status, body, code, retryable) => {
      await expect(
        searchYouTubeVideos(
          requestContext(),
          searchOptions({
            fetchImpl: () => Promise.resolve(response(JSON.stringify(body), { status })),
          }),
        ),
      ).rejects.toMatchObject({ failureCode: code, retryable, httpStatus: status });
    },
  );

  it("rejects wrong content types, oversized bodies and slow requests", async () => {
    await expect(
      searchYouTubeVideos(
        requestContext(),
        searchOptions({
          fetchImpl: () =>
            Promise.resolve(response(searchFixture, { headers: { "content-type": "text/html" } })),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE" });
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200));
        controller.enqueue(new Uint8Array(200));
        controller.close();
      },
    });
    await expect(
      searchYouTubeVideos(
        requestContext(),
        searchOptions({
          maxResponseBytes: 256,
          fetchImpl: () => Promise.resolve(response(oversized)),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE" });
    await expect(
      searchYouTubeVideos(
        requestContext(),
        searchOptions({
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

  it("does not reach fetch when the policy-aware request context rejects collection", async () => {
    let called = false;
    const denied: YouTubeRequestContext = {
      signal: new AbortController().signal,
      request() {
        throw new RadarIngestionFailure("POLICY_DENIED", false);
      },
    };
    await expect(
      searchYouTubeVideos(
        denied,
        searchOptions({
          fetchImpl: () => {
            called = true;
            return Promise.resolve(response(searchFixture));
          },
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "POLICY_DENIED" });
    expect(called).toBe(false);
  });
});

describe("YouTube related-video search adapter", () => {
  it("keeps bounded search rank separate from chart observations", async () => {
    const result = await searchYouTubeVideos(requestContext(), searchOptions());
    expect(result).toMatchObject({
      fetchedAt,
      approximateTotalResults: 120,
      nextPageAvailable: true,
      scope: {
        query: "실시간 트렌드",
        order: "relevance",
        regionCode: "KR",
        meaning: "RANK_WITHIN_THIS_BOUNDED_SEARCH_RESPONSE_NOT_A_YOUTUBE_CHART",
      },
      completion: { status: "SUCCEEDED", observationCount: 2 },
    });
    expect(result.records[0]).toMatchObject({
      videoId: "AbCdEfGhI01",
      title: "한글 관련 영상",
      rankWithinResponse: 1,
      observedAt: fetchedAt,
    });
    expect(result.records[0]).not.toHaveProperty("metric");
  });

  it("deduplicates identical search videos but rejects conflicting duplicates", async () => {
    const payload = JSON.parse(searchFixture) as {
      items: unknown[];
      pageInfo: { resultsPerPage: number };
    };
    payload.items.push(payload.items[0]);
    payload.pageInfo.resultsPerPage = 3;
    const deduplicated = await searchYouTubeVideos(
      requestContext(),
      searchOptions({
        maxResults: 3,
        fetchImpl: () => Promise.resolve(response(JSON.stringify(payload))),
      }),
    );
    expect(deduplicated.records).toHaveLength(2);
    const conflict = JSON.parse(JSON.stringify(payload)) as {
      items: Array<{ snippet: { title: string } }>;
    };
    conflict.items[2]!.snippet.title = "conflicting title";
    await expect(
      searchYouTubeVideos(
        requestContext(),
        searchOptions({
          maxResults: 3,
          fetchImpl: () => Promise.resolve(response(JSON.stringify(conflict))),
        }),
      ),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE" });
  });
});

describe("YouTube video statistics adapter", () => {
  it("deduplicates requested IDs and records deleted/private videos as missing", async () => {
    let requested = "";
    const result = await collectYouTubeVideoStatistics(
      requestContext(),
      statisticsOptions({
        fetchImpl: (input: string) => {
          requested = input;
          return Promise.resolve(response(videosFixture));
        },
      }),
    );
    const url = new URL(requested);
    expect(`${url.origin}${url.pathname}`).toBe(YOUTUBE_VIDEOS_ENDPOINT);
    expect(url.searchParams.get("id")).toBe(`AbCdEfGhI01,JkLmNoPqR02,${thirdVideoId}`);
    expect(result.requestedVideoIds).toEqual(["AbCdEfGhI01", "JkLmNoPqR02", thirdVideoId]);
    expect(result.returnedVideoIds).toEqual(["AbCdEfGhI01", "JkLmNoPqR02"]);
    expect(result.missingVideoIds).toEqual([thirdVideoId]);
    expect(result.observations).toHaveLength(4);
    expect(result.observations.map((item) => item.metricName)).toEqual([
      "VIEW_COUNT",
      "LIKE_COUNT",
      "COMMENT_COUNT",
      "VIEW_COUNT",
    ]);
    expect(result.observations.every((item) => item.sourceUpdatedAt === null)).toBe(true);
    expect(result.completion).toMatchObject({ status: "SUCCEEDED", observationCount: 4 });
  });

  it("does not fabricate zeroes when every requested video is unavailable", async () => {
    const result = await collectYouTubeVideoStatistics(
      requestContext(),
      statisticsOptions({
        videoIds: [thirdVideoId],
        fetchImpl: () => Promise.resolve(response(JSON.stringify({ items: [] }))),
      }),
    );
    expect(result).toMatchObject({
      records: [],
      observations: [],
      missingVideoIds: [thirdVideoId],
      completion: { status: "EMPTY_VALID", observationCount: 0 },
    });
  });
});

describe("YouTube mostPopular chart adapter", () => {
  it("preserves region/category comparison scope and emits only chart rank", async () => {
    let requested = "";
    const result = await collectYouTubeMostPopularChart(
      requestContext(),
      chartOptions({
        fetchImpl: (input: string) => {
          requested = input;
          return Promise.resolve(response(chartFixture));
        },
      }),
    );
    const url = new URL(requested);
    expect(url.searchParams.get("chart")).toBe("mostPopular");
    expect(url.searchParams.get("regionCode")).toBe("KR");
    expect(url.searchParams.get("videoCategoryId")).toBe("20");
    expect(result.scope).toMatchObject({
      regionCode: "KR",
      videoCategoryId: "20",
      meaning: "YOUTUBE_MOST_POPULAR_CHART_NOT_TRENDING_NOW",
    });
    expect(result.nextPageAvailable).toBe(true);
    expect(result.observations.map((item) => item.metric)).toEqual([
      { kind: "RANK", value: 1, comparisonKey: result.scope.key },
      { kind: "RANK", value: 2, comparisonKey: result.scope.key },
    ]);
    expect(result.observations.every((item) => item.metricName === "MOST_POPULAR_CHART_RANK")).toBe(
      true,
    );
  });
});

const smoke = process.env.RADAR_YOUTUBE_DATA_API_SMOKE === "1" ? it : it.skip;
smoke(
  "reads one approved YouTube search page and its video statistics without storing",
  async () => {
    const now = new Date();
    const context = requestContext();
    const search = await searchYouTubeVideos(context, {
      query: "대한민국",
      maxResults: 2,
      order: "relevance",
      regionCode: "KR",
      relevanceLanguage: "ko",
      requestKey: "smoke:youtube:search",
    });
    if (search.records.length) {
      const statistics = await collectYouTubeVideoStatistics(context, {
        videoIds: search.records.map((record) => record.videoId),
        sampledAt: now.toISOString(),
        requestKey: "smoke:youtube:videos",
      });
      expect(statistics.completion.pageCount).toBe(1);
    }
    expect(search.completion.pageCount).toBe(1);
  },
  30_000,
);
