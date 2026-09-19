import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RadarIngestionFailure } from "../src/modules/radar/ingestion-service.js";
import {
  collectGoogleTrendingRss,
  GOOGLE_TRENDING_RSS_ENDPOINT,
  parseGoogleTrafficLowerBound,
  parseGoogleTrendingRss,
} from "../src/modules/radar/providers/google/trending-rss.js";

const sampledAt = "2026-09-19T14:20:00.000Z";
const fetchedAt = "2026-09-19T14:20:01.000Z";
let fixture = "";

const parse = (xml = fixture, options = {}) =>
  parseGoogleTrendingRss(xml, { sampledAt, fetchedAt, ...options });

function requestContext(signal = new AbortController().signal) {
  return {
    signal,
    request<T>(
      operation: string,
      requestKey: string,
      perform: (requestSignal: AbortSignal) => Promise<T>,
    ) {
      expect(operation).toBe("trending.rss");
      expect(requestKey).toMatch(/^[0-9a-zA-Z:_-]+$/u);
      return perform(signal);
    },
  };
}

type ResponseBody = ConstructorParameters<typeof Response>[0];

function response(body: ResponseBody = fixture, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type"))
    headers.set("content-type", "application/rss+xml; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function expectFailure(value: () => unknown, failureCode = "INVALID_RESPONSE") {
  try {
    value();
    throw new Error("Expected Radar ingestion failure");
  } catch (error) {
    expect(error).toBeInstanceOf(RadarIngestionFailure);
    expect(error).toMatchObject({ failureCode, retryable: false });
  }
}

fixture = await readFile(
  new URL("./fixtures/radar/google-trending-kr.xml", import.meta.url),
  "utf8",
);

describe("Google Trending RSS parser", () => {
  it("preserves source time, fetch time and approximate traffic as a lower bound", () => {
    const result = parse();
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.completion).toEqual({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 2,
      truncated: false,
      missingCoverage: [],
      failureCode: null,
    });
    expect(
      result.records.map(({ trafficLabel, observation }) => ({
        trafficLabel,
        title: observation.title,
        metric: observation.metric,
        sourceUpdatedAt: observation.sourceUpdatedAt,
        sampledAt: observation.sampledAt,
        sourceUrl: observation.sourceUrl,
      })),
    ).toEqual([
      {
        trafficLabel: "10K+",
        title: "한글 & English",
        metric: { kind: "LOWER_BOUND", value: 10_000 },
        sourceUpdatedAt: "2026-09-19T14:10:00.000Z",
        sampledAt,
        sourceUrl: GOOGLE_TRENDING_RSS_ENDPOINT,
      },
      {
        trafficLabel: "1,000+",
        title: "새 검색어",
        metric: { kind: "LOWER_BOUND", value: 1_000 },
        sourceUpdatedAt: "2026-09-19T13:50:00.000Z",
        sampledAt,
        sourceUrl: GOOGLE_TRENDING_RSS_ENDPOINT,
      },
    ]);
  });

  it("is deterministic across collection retries and deduplicates identical feed items", () => {
    const once = parse();
    const duplicate = fixture.replace(
      "</channel>",
      `${fixture.match(/<item>[\s\S]*?<\/item>/u)?.[0] ?? ""}\n</channel>`,
    );
    const retried = parse(duplicate);
    expect(retried.records).toEqual(once.records);
    expect(retried.completion.observationCount).toBe(2);
  });

  it("distinguishes a valid empty channel from malformed XML", () => {
    const empty = parse(
      `<?xml version="1.0"?><rss><channel><link>${GOOGLE_TRENDING_RSS_ENDPOINT.replace("&", "&amp;")}</link></channel></rss>`,
    );
    expect(empty).toMatchObject({
      records: [],
      completion: { status: "EMPTY_VALID", observationCount: 0, pageCount: 1 },
    });
    expectFailure(() => parse("<rss><channel><item></channel></rss>"));
  });

  it.each([
    ["100+", 100],
    ["1,000+", 1_000],
    ["1.5K+", 1_500],
    ["2M+", 2_000_000],
  ])("parses traffic band %s without treating it as an exact count", (label, lowerBound) => {
    expect(parseGoogleTrafficLowerBound(label)).toEqual({ label, lowerBound });
  });

  it.each(["100", "1K", "many+", "1.2345K+", "9007199254740992+"])(
    "rejects ambiguous traffic label %s",
    (label) => expectFailure(() => parseGoogleTrafficLowerBound(label)),
  );

  it("rejects DOCTYPE/entity input before parsing", () => {
    expectFailure(() =>
      parse(
        `<!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel><link>${GOOGLE_TRENDING_RSS_ENDPOINT.replace("&", "&amp;")}</link><item><title>&x;</title><ht:approx_traffic>100+</ht:approx_traffic><link>${GOOGLE_TRENDING_RSS_ENDPOINT.replace("&", "&amp;")}</link><pubDate>Sat, 19 Sep 2026 07:10:00 -0700</pubDate></item></channel></rss>`,
      ),
    );
  });

  it("rejects excessive nesting, item counts, invalid URLs, timestamps and fields", () => {
    const deeplyNested = `<rss>${"<x>".repeat(20)}${"</x>".repeat(20)}</rss>`;
    expectFailure(() => parse(deeplyNested));
    expectFailure(() => parse(fixture, { maxItems: 1 }));
    expectFailure(() =>
      parse(
        fixture.replaceAll(
          GOOGLE_TRENDING_RSS_ENDPOINT.replace("&", "&amp;"),
          "https://evil.example/rss",
        ),
      ),
    );
    expectFailure(() => parse(fixture.replace("Sat, 19 Sep 2026 07:10:00 -0700", "tomorrow")));
    expectFailure(() => parse(fixture.replace("10K+", "unknown")));
    expectFailure(() => parse(fixture.replace("한글 &amp; English", "&unknown;")));
    expectFailure(() => parse(fixture, { maxResponseBytes: 100 }));
  });
});

describe("Google Trending RSS HTTP boundary", () => {
  it("uses the fixed KR HTTPS endpoint without following redirects", async () => {
    let requested = "";
    let requestInit: RequestInit | undefined;
    const result = await collectGoogleTrendingRss(requestContext(), {
      sampledAt,
      requestKey: "attempt1:page1",
      now: () => new Date(fetchedAt),
      fetchImpl: (input, init) => {
        requested = input;
        requestInit = init;
        return Promise.resolve(response());
      },
    });
    expect(requested).toBe(GOOGLE_TRENDING_RSS_ENDPOINT);
    expect(requestInit).toMatchObject({ method: "GET", redirect: "manual" });
    expect(result.completion).toMatchObject({ status: "SUCCEEDED", observationCount: 2 });
  });

  it.each([
    [302, { location: "https://evil.example/rss" }],
    [200, { "content-type": "text/html" }],
    [200, { "content-length": "999999" }],
  ])("rejects unsafe status/header combination %#", async (status, headers) => {
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        now: () => new Date(fetchedAt),
        fetchImpl: () =>
          Promise.resolve(response(status === 302 ? null : fixture, { status, headers })),
      }),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE", retryable: false });
  });

  it("limits the decoded streaming body even without Content-Length", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200));
        controller.enqueue(new Uint8Array(200));
        controller.close();
      },
    });
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        maxResponseBytes: 256,
        now: () => new Date(fetchedAt),
        fetchImpl: () => Promise.resolve(response(oversized)),
      }),
    ).rejects.toMatchObject({ failureCode: "INVALID_RESPONSE", retryable: false });
  });

  it("classifies rate limits and upstream responses for the R04 retry ledger", async () => {
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        now: () => new Date(fetchedAt),
        fetchImpl: () =>
          Promise.resolve(response(null, { status: 429, headers: { "retry-after": "5" } })),
      }),
    ).rejects.toMatchObject({
      failureCode: "RATE_LIMIT",
      retryable: true,
      httpStatus: 429,
      retryAfterMilliseconds: 5_000,
    });
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        now: () => new Date(fetchedAt),
        fetchImpl: () => Promise.resolve(response(null, { status: 503 })),
      }),
    ).rejects.toMatchObject({ failureCode: "UPSTREAM", retryable: true, httpStatus: 503 });
  });

  it("aborts slow requests and classifies network failures without leaking details", async () => {
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        timeoutMilliseconds: 10,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      }),
    ).rejects.toMatchObject({ failureCode: "TIMEOUT", retryable: true });
    await expect(
      collectGoogleTrendingRss(requestContext(), {
        sampledAt,
        requestKey: "attempt1:page1",
        fetchImpl: () => Promise.reject(new Error("https://secret.invalid/?token=do-not-leak")),
      }),
    ).rejects.toEqual(expect.objectContaining({ failureCode: "UPSTREAM", retryable: true }));
  });

  it("does not call fetch when the parent collection signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      collectGoogleTrendingRss(requestContext(controller.signal), {
        sampledAt,
        requestKey: "attempt1:page1",
        fetchImpl: () => {
          called = true;
          return Promise.resolve(response());
        },
      }),
    ).rejects.toMatchObject({ failureCode: "TIMEOUT", retryable: true });
    expect(called).toBe(false);
  });
});

const smoke = process.env.RADAR_GOOGLE_RSS_SMOKE === "1" ? it : it.skip;
smoke(
  "parses the current public KR feed without storing or publishing it",
  async () => {
    const now = new Date();
    const result = await collectGoogleTrendingRss(requestContext(), {
      sampledAt: now.toISOString(),
      requestKey: "smoke:page1",
      timeoutMilliseconds: 10_000,
    });
    expect(result.completion.pageCount).toBe(1);
    expect(["SUCCEEDED", "EMPTY_VALID"]).toContain(result.completion.status);
    expect(result.completion.observationCount).toBe(result.records.length);
  },
  20_000,
);
