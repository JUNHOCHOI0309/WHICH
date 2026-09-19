import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  radarIngestionRuns,
  radarProviderRequests,
  radarQuotaDailyUsage,
  radarRunQuotaUsage,
} from "../src/database/schema/radar-ingestion.js";
import {
  classifyRadarHttpFailure,
  createRadarIngestionService,
  RadarBudgetFailure,
  RadarIngestionFailure,
  radarCompletionSchema,
} from "../src/modules/radar/ingestion-service.js";
import {
  defaultRadarActivation,
  type RadarActivation,
} from "../src/modules/radar/source-policy.js";
import type { RadarSource } from "../src/modules/radar/source-registry.js";
import { collectGoogleTrendingRss } from "../src/modules/radar/providers/google/trending-rss.js";
import { collectNaverNews } from "../src/modules/radar/providers/naver/news.js";
import { collectNaverSearchTrend } from "../src/modules/radar/providers/naver/search-trend.js";
import { searchYouTubeVideos } from "../src/modules/radar/providers/youtube/search.js";
import { collectYouTubeVideoStatistics } from "../src/modules/radar/providers/youtube/videos.js";
import { createTestDatabase } from "./helpers/test-database.js";

const start = new Date("2026-09-20T00:00:00.000Z");
let currentTime = new Date(start);
let database: Database;
let dropDatabase: () => Promise<void>;

const options = {
  leaseMilliseconds: 1_000,
  timeoutMilliseconds: 100,
  retryBaseMilliseconds: 200,
  retryMaxMilliseconds: 1_600,
  now: () => currentTime,
};

function approved(source: RadarSource = "GOOGLE_TRENDING_RSS"): RadarActivation {
  const activation = defaultRadarActivation(source);
  activation.enabled = true;
  activation.killSwitch = false;
  activation.credentialsVerified = true;
  activation.quotaScopeId = `fixture-${source.toLowerCase()}`;
  activation.retentionHours = 24;
  for (const capability of ["collect", "store"] as const) {
    activation.rights[capability] = {
      status: "APPROVED",
      evidenceUrl: "https://example.com/fixture-approval",
      reviewedBy: "fixture-reviewer",
      checkedAt: "2026-09-19T00:00:00Z",
      expiresAt: "2026-10-01T00:00:00Z",
    };
  }
  return activation;
}

function command(source: RadarSource = "GOOGLE_TRENDING_RSS", operation = "trending.rss") {
  return {
    dispatchKey: `test:${randomUUID()}`,
    source,
    operation,
    sampledAt: currentTime.toISOString(),
    maxAttempts: 3,
  };
}

beforeAll(async () => {
  const test = await createTestDatabase();
  database = test.database;
  dropDatabase = () => test.drop();
}, 30_000);

beforeEach(async () => {
  currentTime = new Date(start);
  await database.db.delete(radarIngestionRuns);
  await database.db.delete(radarQuotaDailyUsage);
});

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("Radar ingestion dispatch and leases", () => {
  it("deduplicates concurrent dispatches and preserves the logical sample", async () => {
    const service = createRadarIngestionService(database.db, options);
    const input = command();
    const activation = approved();
    const runs = await Promise.all(
      Array.from({ length: 8 }, () => service.dispatch(input, activation)),
    );
    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    expect(runs[0]).toMatchObject({ status: "PENDING", attemptCount: 0 });
    expect(runs[0]?.sampledAt.toISOString()).toBe(input.sampledAt);
    expect(await database.db.select().from(radarIngestionRuns)).toHaveLength(1);
  });

  it("rejects dispatch-key reuse with different parameters", async () => {
    const service = createRadarIngestionService(database.db, options);
    const input = command();
    await service.dispatch(input, approved());
    await expect(
      service.dispatch({ ...input, sampledAt: "2026-09-20T01:00:00Z" }, approved()),
    ).rejects.toThrow("RADAR_DISPATCH_KEY_CONFLICT");
  });

  it("does not dispatch when rights, credentials, policy or operation are not approved", async () => {
    const service = createRadarIngestionService(database.db, options);
    await expect(
      service.dispatch(command(), defaultRadarActivation("GOOGLE_TRENDING_RSS")),
    ).rejects.toMatchObject({
      failureCode: "POLICY_DENIED",
    });
    await expect(
      service.dispatch(command("NAVER_SEARCH", "news.search"), {
        ...approved("NAVER_SEARCH"),
        credentialsVerified: false,
      }),
    ).rejects.toMatchObject({ failureCode: "POLICY_DENIED" });
    await expect(
      service.dispatch(command("GOOGLE_TRENDING_RSS", "unknown"), approved()),
    ).rejects.toMatchObject({ failureCode: "POLICY_DENIED" });
    expect(await database.db.select().from(radarIngestionRuns)).toHaveLength(0);
  });

  it("lets only one Worker claim a run", async () => {
    const service = createRadarIngestionService(database.db, options);
    await service.dispatch(command(), approved());
    const [a, b] = await Promise.all([service.claimNext(), service.claimNext()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(a ?? b).toMatchObject({ attemptCount: 1, maxAttempts: 3 });
  });

  it("recovers an expired lease and fences the old Worker", async () => {
    const service = createRadarIngestionService(database.db, options);
    const run = await service.dispatch(command(), approved());
    const first = await service.claimNext();
    expect(first?.id).toBe(run.id);
    currentTime = new Date(start.getTime() + options.leaseMilliseconds + 1);
    expect(await service.markRunFailure(first!, new RadarIngestionFailure("UPSTREAM", true))).toBe(
      "STALE_CLAIM",
    );
    const recovered = await service.claimNext();
    expect(recovered).toMatchObject({ id: run.id, attemptCount: 2 });
    expect(recovered?.claimToken).not.toBe(first?.claimToken);
    await expect(
      service.completeRun(first!, {
        status: "EMPTY_VALID",
        pageCount: 1,
        observationCount: 0,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      }),
    ).rejects.toMatchObject({ failureCode: "LEASE_EXPIRED" });
    expect(
      await service.completeRun(recovered!, {
        status: "EMPTY_VALID",
        pageCount: 1,
        observationCount: 0,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      }),
    ).toMatchObject({ status: "EMPTY_VALID" });
  });

  it("fails a max-attempt run after its lease expires", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    await service.dispatch({ ...command(), maxAttempts: 1 }, activation);
    const claim = await service.claimNext();
    const reservation = await service.reserveProviderRequest(
      claim!,
      activation,
      "trending.rss",
      "attempt1:page1",
    );
    currentTime = new Date(start.getTime() + options.leaseMilliseconds + 1);
    expect(await service.claimNext()).toBeNull();
    expect(await service.getRun(claim!.id)).toMatchObject({
      status: "FAILED",
      failureCode: "LEASE_EXPIRED",
      completedAt: currentTime,
    });
    const [providerRequest] = await database.db
      .select()
      .from(radarProviderRequests)
      .where(eq(radarProviderRequests.id, reservation.id));
    expect(providerRequest).toMatchObject({
      status: "FAILED",
      failureCode: "LEASE_EXPIRED",
      retryable: false,
      completedAt: currentTime,
    });
  });

  it("renews only a live, current lease", async () => {
    const service = createRadarIngestionService(database.db, options);
    await service.dispatch(command(), approved());
    const claim = await service.claimNext();
    currentTime = new Date(start.getTime() + 500);
    expect(await service.renewLease(claim!)).toEqual(
      new Date(currentTime.getTime() + options.leaseMilliseconds),
    );
    currentTime = new Date(currentTime.getTime() + options.leaseMilliseconds + 1);
    expect(await service.renewLease(claim!)).toBeNull();
  });
});

describe("Radar run outcomes and retries", () => {
  it("runs YouTube related search through its dedicated quota pool", async () => {
    currentTime = new Date("2026-09-20T01:00:01.000Z");
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("YOUTUBE_DATA_API");
    const run = await service.dispatch(command("YOUTUBE_DATA_API", "search.list"), activation);
    const claim = await service.claimNext();
    const json = await readFile(
      new URL("./fixtures/radar/youtube-search.json", import.meta.url),
      "utf8",
    );
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        const collected = await searchYouTubeVideos(context, {
          query: "실시간 트렌드",
          maxResults: 2,
          requestKey: "attempt1:page1",
          credentials: { apiKey: "fixture-key" },
          now: () => currentTime,
          fetchImpl: () =>
            Promise.resolve(
              new Response(json, {
                status: 200,
                headers: { "content-type": "application/json; charset=utf-8" },
              }),
            ),
        });
        expect(collected.records).toHaveLength(2);
        return collected.completion;
      }),
    ).toBe("SUCCEEDED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 2,
    });
    expect(await database.db.select().from(radarProviderRequests)).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", operation: "search.list", unitCost: 1 }),
    ]);
    expect(await database.db.select().from(radarQuotaDailyUsage)).toEqual([
      expect.objectContaining({ requestCount: 1, unitCount: 1, pool: "youtube-search" }),
    ]);
  });

  it("runs YouTube statistics through the shared general quota pool", async () => {
    currentTime = new Date("2026-09-20T01:00:01.000Z");
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("YOUTUBE_DATA_API");
    const run = await service.dispatch(command("YOUTUBE_DATA_API", "videos.list"), activation);
    const claim = await service.claimNext();
    const json = await readFile(
      new URL("./fixtures/radar/youtube-videos.json", import.meta.url),
      "utf8",
    );
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        const collected = await collectYouTubeVideoStatistics(context, {
          videoIds: ["AbCdEfGhI01", "JkLmNoPqR02"],
          sampledAt: claim!.sampledAt.toISOString(),
          requestKey: "attempt1:batch1",
          credentials: { apiKey: "fixture-key" },
          now: () => currentTime,
          fetchImpl: () =>
            Promise.resolve(
              new Response(json, {
                status: 200,
                headers: { "content-type": "application/json; charset=utf-8" },
              }),
            ),
        });
        expect(collected.observations).toHaveLength(4);
        return collected.completion;
      }),
    ).toBe("SUCCEEDED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 4,
    });
    expect(await database.db.select().from(radarProviderRequests)).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", operation: "videos.list", unitCost: 1 }),
    ]);
    expect(await database.db.select().from(radarQuotaDailyUsage)).toEqual([
      expect.objectContaining({ requestCount: 1, unitCount: 1, pool: "youtube-general" }),
    ]);
  });

  it("runs NAVER news through its separate request and completion ledger", async () => {
    currentTime = new Date("2026-09-20T00:00:00.000Z");
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    const run = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claim = await service.claimNext();
    const json = await readFile(
      new URL("./fixtures/radar/naver-news.json", import.meta.url),
      "utf8",
    );
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        const collected = await collectNaverNews(context, {
          query: "한글",
          display: 2,
          start: 1,
          sort: "date",
          sampledAt: claim!.sampledAt.toISOString(),
          requestKey: "attempt1:page1",
          credentials: { clientId: "fixture-id", clientSecret: "fixture-secret" },
          now: () => currentTime,
          fetchImpl: () =>
            Promise.resolve(
              new Response(json, {
                status: 200,
                headers: { "content-type": "application/json; charset=utf-8" },
              }),
            ),
        });
        expect(collected.records).toHaveLength(2);
        return collected.completion;
      }),
    ).toBe("SUCCEEDED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 2,
    });
    expect(await database.db.select().from(radarProviderRequests)).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", operation: "news.search", unitCost: 1 }),
    ]);
    expect(await database.db.select().from(radarQuotaDailyUsage)).toEqual([
      expect.objectContaining({ requestCount: 1, unitCount: 1, pool: "naver-search" }),
    ]);
  });

  it("runs NAVER search trend through a distinct quota pool", async () => {
    currentTime = new Date("2026-09-20T00:00:00.000Z");
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_DATALAB");
    const run = await service.dispatch(command("NAVER_DATALAB", "search.trend"), activation);
    const claim = await service.claimNext();
    const json = await readFile(
      new URL("./fixtures/radar/naver-search-trend.json", import.meta.url),
      "utf8",
    );
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        const collected = await collectNaverSearchTrend(context, {
          startDate: "2026-09-17",
          endDate: "2026-09-19",
          keywordGroups: [
            { groupName: "한글", keywords: ["한글", "korean"] },
            { groupName: "영어", keywords: ["영어", "english"] },
          ],
          sampledAt: claim!.sampledAt.toISOString(),
          requestKey: "attempt1:page1",
          credentials: { clientId: "fixture-id", clientSecret: "fixture-secret" },
          now: () => currentTime,
          fetchImpl: () =>
            Promise.resolve(
              new Response(json, {
                status: 200,
                headers: { "content-type": "application/json; charset=utf-8" },
              }),
            ),
        });
        expect(collected.observations).toHaveLength(6);
        return collected.completion;
      }),
    ).toBe("SUCCEEDED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 6,
    });
    expect(await database.db.select().from(radarProviderRequests)).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", operation: "search.trend", unitCost: 1 }),
    ]);
    expect(await database.db.select().from(radarQuotaDailyUsage)).toEqual([
      expect.objectContaining({ requestCount: 1, unitCount: 1, pool: "naver-datalab" }),
    ]);
  });

  it("runs the Google RSS adapter through the request and completion ledgers", async () => {
    currentTime = new Date("2026-09-19T14:20:01.000Z");
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    const run = await service.dispatch(command(), activation);
    const claim = await service.claimNext();
    const xml = await readFile(
      new URL("./fixtures/radar/google-trending-kr.xml", import.meta.url),
      "utf8",
    );
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        const collected = await collectGoogleTrendingRss(context, {
          sampledAt: claim!.sampledAt.toISOString(),
          requestKey: "attempt1:page1",
          now: () => currentTime,
          fetchImpl: () =>
            Promise.resolve(
              new Response(xml, {
                status: 200,
                headers: { "content-type": "application/rss+xml; charset=utf-8" },
              }),
            ),
        });
        expect(collected.records).toHaveLength(2);
        return collected.completion;
      }),
    ).toBe("SUCCEEDED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "SUCCEEDED",
      pageCount: 1,
      observationCount: 2,
    });
    expect(await database.db.select().from(radarProviderRequests)).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", operation: "trending.rss", unitCost: 1 }),
    ]);
    expect(await database.db.select().from(radarQuotaDailyUsage)).toEqual([
      expect.objectContaining({ requestCount: 1, unitCount: 1, pool: "google-rss" }),
    ]);
  });

  it("fails closed without retry when the claimed policy activation changes", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    const run = await service.dispatch(command(), activation);
    const claim = await service.claimNext();
    expect(
      await service.processClaim(
        claim!,
        { ...activation, policyVersion: "radar-sources-outdated" },
        () => Promise.reject(new Error("collector must not run")),
      ),
    ).toBe("FAILED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "FAILED",
      failureCode: "POLICY_DENIED",
      attemptCount: 1,
    });
  });

  it.each([
    [
      "SUCCEEDED",
      {
        status: "SUCCEEDED",
        pageCount: 2,
        observationCount: 3,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
    ],
    [
      "EMPTY_VALID",
      {
        status: "EMPTY_VALID",
        pageCount: 1,
        observationCount: 0,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
    ],
  ] as const)("records %s distinctly", async (status, result) => {
    const service = createRadarIngestionService(database.db, options);
    const run = await service.dispatch(command(), approved());
    const claim = await service.claimNext();
    expect(
      await service.processClaim(claim!, approved(), () =>
        Promise.resolve({ ...result, missingCoverage: [...result.missingCoverage] }),
      ),
    ).toBe(status);
    expect(await service.getRun(run.id)).toMatchObject({
      ...result,
      status,
      completedAt: currentTime,
    });
  });

  it("records a middle-page failure as PARTIAL with missing coverage", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    const run = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claim = await service.claimNext();
    const outcome = await service.processClaim(claim!, activation, async (context) => {
      await context.request("news.search", "attempt1:page1", () => Promise.resolve({ items: 2 }));
      try {
        await context.request("news.search", "attempt1:page2", () =>
          Promise.reject(classifyRadarHttpFailure(503)),
        );
      } catch (error) {
        expect(error).toMatchObject({ failureCode: "UPSTREAM", retryable: true });
      }
      return {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 2,
        truncated: true,
        missingCoverage: ["page 2 and later were not collected"],
        failureCode: "UPSTREAM",
      };
    });
    expect(outcome).toBe("PARTIAL");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "PARTIAL",
      pageCount: 1,
      observationCount: 2,
      truncated: true,
      missingCoverage: ["page 2 and later were not collected"],
      failureCode: "UPSTREAM",
    });
    const requests = await database.db
      .select()
      .from(radarProviderRequests)
      .where(eq(radarProviderRequests.runId, run.id));
    expect(requests.map((request) => request.status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("does not permit success after a recorded provider failure", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    await service.dispatch(command(), activation);
    const claim = await service.claimNext();
    const request = await service.reserveProviderRequest(
      claim!,
      activation,
      "trending.rss",
      "attempt1:page1",
    );
    await service.finishProviderRequest(claim!, request.id, {
      status: "FAILED",
      failure: classifyRadarHttpFailure(503),
    });
    await expect(
      service.completeRun(claim!, {
        status: "SUCCEEDED",
        pageCount: 1,
        observationCount: 1,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      }),
    ).rejects.toThrow("RADAR_FAILED_REQUEST_REQUIRES_PARTIAL_RESULT");
    expect(
      await service.completeRun(claim!, {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 1,
        truncated: true,
        missingCoverage: ["provider response was not available"],
        failureCode: "UPSTREAM",
      }),
    ).toMatchObject({ status: "PARTIAL" });
  });

  it.each([
    [429, "RATE_LIMIT", 5_000],
    [500, "UPSTREAM", null],
    [503, "UPSTREAM", null],
  ] as const)(
    "retries HTTP %s with bounded exponential/provider backoff",
    async (httpStatus, failureCode, retryAfter) => {
      const service = createRadarIngestionService(database.db, options);
      const activation = approved();
      const run = await service.dispatch(command(), activation);
      const claim = await service.claimNext();
      expect(
        await service.processClaim(claim!, activation, async (context) => {
          await context.request("trending.rss", "attempt1:page1", () =>
            Promise.reject(classifyRadarHttpFailure(httpStatus, retryAfter)),
          );
          throw new Error("unreachable");
        }),
      ).toBe("RETRY_SCHEDULED");
      const expectedDelay = retryAfter ?? options.retryBaseMilliseconds;
      expect(await service.getRun(run.id)).toMatchObject({
        status: "PENDING",
        failureCode,
        availableAt: new Date(start.getTime() + expectedDelay),
        completedAt: null,
      });
      expect(await service.claimNext()).toBeNull();
      currentTime = new Date(start.getTime() + expectedDelay);
      expect(await service.claimNext()).toMatchObject({ id: run.id, attemptCount: 2 });
    },
  );

  it.each([
    [401, "AUTH"],
    [403, "AUTH"],
    [404, "INVALID_RESPONSE"],
  ] as const)("does not retry HTTP %s", async (httpStatus, failureCode) => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    const run = await service.dispatch(command(), activation);
    const claim = await service.claimNext();
    expect(
      await service.processClaim(claim!, activation, async (context) => {
        await context.request("trending.rss", "attempt1:page1", () =>
          Promise.reject(classifyRadarHttpFailure(httpStatus)),
        );
        throw new Error("unreachable");
      }),
    ).toBe("FAILED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "FAILED",
      failureCode,
      attemptCount: 1,
      completedAt: currentTime,
    });
  });

  it("aborts and retries a timed-out collector", async () => {
    const timeoutOptions = { ...options, leaseMilliseconds: 200, timeoutMilliseconds: 20 };
    const service = createRadarIngestionService(database.db, timeoutOptions);
    const activation = approved();
    const run = await service.dispatch(command(), activation);
    const claim = await service.claimNext();
    let observedAbort = false;
    expect(
      await service.processClaim(
        claim!,
        activation,
        ({ signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              observedAbort = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    ).toBe("RETRY_SCHEDULED");
    expect(observedAbort).toBe(true);
    expect(await service.getRun(run.id)).toMatchObject({
      status: "PENDING",
      failureCode: "TIMEOUT",
    });
  });

  it("exhausts attempts and records a terminal failure", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved();
    const run = await service.dispatch({ ...command(), maxAttempts: 2 }, activation);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const claim = await service.claimNext();
      const result = await service.processClaim(claim!, activation, () =>
        Promise.reject(new Error("contains https://secret.example/?token=must-not-be-stored")),
      );
      expect(result).toBe(attempt === 1 ? "RETRY_SCHEDULED" : "FAILED");
      if (attempt === 1) currentTime = new Date(start.getTime() + options.retryBaseMilliseconds);
    }
    expect(await service.getRun(run.id)).toMatchObject({
      status: "FAILED",
      failureCode: "UPSTREAM",
      attemptCount: 2,
      lastError: "Provider attempt failed (UPSTREAM).",
      completedAt: currentTime,
    });
  });

  it("refuses inconsistent success/empty/partial completion shapes", () => {
    for (const invalid of [
      {
        status: "SUCCEEDED",
        pageCount: 0,
        observationCount: 1,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
      {
        status: "SUCCEEDED",
        pageCount: 1,
        observationCount: 0,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
      {
        status: "EMPTY_VALID",
        pageCount: 0,
        observationCount: 0,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
      {
        status: "EMPTY_VALID",
        pageCount: 1,
        observationCount: 1,
        truncated: false,
        missingCoverage: [],
        failureCode: null,
      },
      {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 0,
        truncated: true,
        missingCoverage: ["all pages"],
        failureCode: "UPSTREAM",
      },
      {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 1,
        truncated: false,
        missingCoverage: [],
        failureCode: "UPSTREAM",
      },
      {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 1,
        truncated: true,
        missingCoverage: [],
        failureCode: null,
      },
      {
        status: "PARTIAL",
        pageCount: 1,
        observationCount: 1,
        truncated: true,
        missingCoverage: ["x".repeat(201)],
        failureCode: "UPSTREAM",
      },
    ]) {
      expect(radarCompletionSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("Radar request budget ledger", () => {
  it("reserves duplicate request keys once and charges retry/page keys separately", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    const run = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claim = await service.claimNext();
    const first = await service.reserveProviderRequest(
      claim!,
      activation,
      "news.search",
      "attempt1:page1",
    );
    const duplicate = await service.reserveProviderRequest(
      claim!,
      activation,
      "news.search",
      "attempt1:page1",
    );
    const next = await service.reserveProviderRequest(
      claim!,
      activation,
      "news.search",
      "attempt1:page2",
    );
    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    expect(next.id).not.toBe(first.id);
    const [daily] = await database.db.select().from(radarQuotaDailyUsage);
    const [perRun] = await database.db.select().from(radarRunQuotaUsage);
    expect(daily).toMatchObject({ requestCount: 2, unitCount: 2 });
    expect(perRun).toMatchObject({ runId: run.id, requestCount: 2, unitCount: 2 });
  });

  it("atomically prevents two runs from exceeding a shared daily pool", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    const a = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const b = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claimA = await service.claimNext();
    const claimB = await service.claimNext();
    expect(new Set([claimA?.id, claimB?.id])).toEqual(new Set([a.id, b.id]));
    // Seed only usage counters, not fake request rows, to exercise the final shared slot.
    await database.db.insert(radarQuotaDailyUsage).values({
      policyVersion: activation.policyVersion,
      source: activation.source,
      quotaScopeId: activation.quotaScopeId,
      pool: "naver-search",
      dayKey: "2026-09-20",
      requestCount: 299,
      unitCount: 299,
    });
    const results = await Promise.allSettled([
      service.reserveProviderRequest(claimA!, activation, "news.search", "attempt1:page1"),
      service.reserveProviderRequest(claimB!, activation, "news.search", "attempt1:page1"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    const rejectedReason: unknown = rejected?.status === "rejected" ? rejected.reason : undefined;
    expect(rejectedReason).toBeInstanceOf(RadarBudgetFailure);
    const [daily] = await database.db.select().from(radarQuotaDailyUsage);
    expect(daily).toMatchObject({ requestCount: 300, unitCount: 300 });
  });

  it("fails closed at the per-run limit without overcharging", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    const run = await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claim = await service.claimNext();
    for (let page = 1; page <= 10; page += 1) {
      await service.reserveProviderRequest(
        claim!,
        activation,
        "news.search",
        `attempt1:page${page}`,
      );
    }
    await expect(
      service.reserveProviderRequest(claim!, activation, "news.search", "attempt1:page11"),
    ).rejects.toMatchObject({ failureCode: "BUDGET_EXHAUSTED" });
    const [daily] = await database.db.select().from(radarQuotaDailyUsage);
    const [perRun] = await database.db.select().from(radarRunQuotaUsage);
    expect(daily?.requestCount).toBe(10);
    expect(perRun?.requestCount).toBe(10);
    expect(
      await database.db
        .select()
        .from(radarProviderRequests)
        .where(eq(radarProviderRequests.runId, run.id)),
    ).toHaveLength(10);
  });

  it("rejects stale leases, wrong policy scopes and request-key reuse across operations", async () => {
    const service = createRadarIngestionService(database.db, options);
    const activation = approved("NAVER_SEARCH");
    await service.dispatch(command("NAVER_SEARCH", "news.search"), activation);
    const claim = await service.claimNext();
    await service.reserveProviderRequest(claim!, activation, "news.search", "attempt1:page1");
    await expect(
      service.reserveProviderRequest(claim!, activation, "search.trend", "attempt1:page1"),
    ).rejects.toThrow("RADAR_REQUEST_KEY_CONFLICT");
    await expect(
      service.reserveProviderRequest(
        claim!,
        { ...activation, quotaScopeId: "wrong-project" },
        "news.search",
        "attempt1:page2",
      ),
    ).rejects.toBeDefined();
    currentTime = new Date(start.getTime() + options.leaseMilliseconds + 1);
    await expect(
      service.reserveProviderRequest(claim!, activation, "news.search", "attempt1:page2"),
    ).rejects.toMatchObject({ failureCode: "LEASE_EXPIRED" });
  });
});

describe("Radar ingestion configuration and HTTP classification", () => {
  it("requires leases to outlive timeout and a valid retry range", () => {
    expect(() =>
      createRadarIngestionService(database.db, { ...options, leaseMilliseconds: 100 }),
    ).toThrow("lease must outlive");
    expect(() =>
      createRadarIngestionService(database.db, {
        ...options,
        retryBaseMilliseconds: 2_000,
        retryMaxMilliseconds: 1_000,
      }),
    ).toThrow("retry maximum");
  });

  it("classifies provider HTTP status without persisting response bodies", () => {
    expect(classifyRadarHttpFailure(429, 1_000)).toMatchObject({
      failureCode: "RATE_LIMIT",
      retryable: true,
      httpStatus: 429,
      retryAfterMilliseconds: 1_000,
    });
    expect(classifyRadarHttpFailure(503)).toMatchObject({
      failureCode: "UPSTREAM",
      retryable: true,
    });
    expect(classifyRadarHttpFailure(401)).toMatchObject({
      failureCode: "AUTH",
      retryable: false,
    });
    expect(classifyRadarHttpFailure(99)).toMatchObject({
      failureCode: "INVALID_RESPONSE",
      retryable: false,
    });
  });

  it("does not mistake arbitrary errors for typed, non-retryable provider failures", () => {
    expect(new RadarIngestionFailure("AUTH", false)).toBeInstanceOf(Error);
  });
});
