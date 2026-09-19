import { describe, expect, it } from "vitest";
import {
  radarEventSchema,
  radarIssueLinkSchema,
  radarObservationSchema,
  radarRunResultSchema,
} from "../src/modules/radar/contracts.js";
import { normalizeRadarObservation } from "../src/modules/radar/normalize.js";

const sample = {
  source: "GOOGLE_TRENDING_RSS",
  sourceItemId: "sample-topic",
  sourceUrl: "https://trends.google.com/trending?geo=KR#fragment",
  title: "  트렌드   질문  ",
  metricName: "search_traffic",
  scope: { countryCode: "KR", queryKey: "sample-topic", dimensionsKey: "all" },
  window: { start: "2026-09-19T00:00:00Z", end: "2026-09-19T01:00:00Z", granularity: "HOUR" },
  sampledAt: "2026-09-19T01:00:00Z",
  sourceUpdatedAt: null,
  metric: { kind: "LOWER_BOUND", value: 1000 },
};

describe("Radar observation contracts", () => {
  it("normalizes display text, fragments and timestamp offsets without losing source query", () => {
    const { observation } = normalizeRadarObservation(sample);
    expect(observation.title).toBe("트렌드 질문");
    expect(observation.sourceUrl).toBe("https://trends.google.com/trending?geo=KR");
    expect(observation.sampledAt).toBe("2026-09-19T01:00:00.000Z");
    expect(observation.sourceUpdatedAt).toBeNull();
    expect(
      normalizeRadarObservation({ ...sample, sampledAt: "2026-09-19T10:00:00+09:00" }),
    ).toEqual(normalizeRadarObservation(sample));
  });
  it("preserves null vs zero and lower-bound vs exact count", () => {
    const missing = normalizeRadarObservation({
      ...sample,
      metric: { kind: "COUNT", value: null },
    });
    const zero = normalizeRadarObservation({ ...sample, metric: { kind: "COUNT", value: 0 } });
    expect(missing.observation.metric.value).toBeNull();
    expect(zero.observation.metric.value).toBe(0);
    expect(missing.observationKey).toBe(zero.observationKey);
    expect(missing.contentHash).not.toBe(zero.contentHash);
    expect(zero.observationKey).not.toBe(normalizeRadarObservation(sample).observationKey);
  });
  it("is retry-idempotent and gives corrected values a new content hash only", () => {
    const original = normalizeRadarObservation(sample);
    expect(normalizeRadarObservation(JSON.parse(JSON.stringify(sample)))).toEqual(original);
    const correction = normalizeRadarObservation({
      ...sample,
      metric: { kind: "LOWER_BOUND", value: 2000 },
    });
    expect(correction.observationKey).toBe(original.observationKey);
    expect(correction.contentHash).not.toBe(original.contentHash);
  });
  it.each([
    { source: "NAVER_SEARCH" },
    { sourceItemId: "different" },
    { metricName: "different" },
    { sampledAt: "2026-09-19T02:00:00Z" },
    { scope: { ...sample.scope, countryCode: "JP" } },
    { scope: { ...sample.scope, dimensionsKey: "mobile" } },
    { window: { ...sample.window, end: "2026-09-19T02:00:00Z" } },
  ])("separates different observation dimensions: %j", (patch) => {
    expect(normalizeRadarObservation({ ...sample, ...patch }).observationKey).not.toBe(
      normalizeRadarObservation(sample).observationKey,
    );
  });
  it("separates provider-normalized comparison cohorts", () => {
    const index = (comparisonKey: string) =>
      normalizeRadarObservation({
        ...sample,
        metric: { kind: "RELATIVE_INDEX", value: 50, comparisonKey },
      });
    expect(index("query-group-a").observationKey).not.toBe(index("query-group-b").observationKey);
  });
  it.each([
    { metric: { kind: "COUNT", value: -1 } },
    { metric: { kind: "COUNT", value: 1.5 } },
    { metric: { kind: "COUNT", value: Number.MAX_SAFE_INTEGER + 1 } },
    { metric: { kind: "COUNT", value: Infinity } },
    { metric: { kind: "RELATIVE_INDEX", value: 101, comparisonKey: "group" } },
    { metric: { kind: "RELATIVE_INDEX", value: 50 } },
    { metric: { kind: "RANK", value: 0, comparisonKey: "chart" } },
    { source: "UNKNOWN_PROVIDER" },
    { title: "   " },
    { sampledAt: "2026-02-30T00:00:00Z" },
    { sampledAt: "2026-09-19T01:00:00" },
    { window: { ...sample.window, start: "2026-09-20T00:00:00Z" } },
    { sourceUrl: "http://example.com" },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:secret@example.com" },
    { unexpected: "must not leak" },
  ])("rejects invalid or ambiguous input: %j", (patch) => {
    expect(radarObservationSchema.safeParse({ ...sample, ...patch }).success).toBe(false);
  });
});

describe("Radar run coverage", () => {
  const run = {
    source: sample.source,
    sampledAt: sample.sampledAt,
    status: "SUCCEEDED",
    observations: [sample],
    failureCode: null,
    truncated: false,
  };
  it("accepts complete, empty, partial and failed runs without conflating them", () => {
    expect(radarRunResultSchema.safeParse(run).success).toBe(true);
    expect(
      radarRunResultSchema.safeParse({ ...run, status: "EMPTY_VALID", observations: [] }).success,
    ).toBe(true);
    expect(
      radarRunResultSchema.safeParse({ ...run, status: "PARTIAL", truncated: true }).success,
    ).toBe(true);
    expect(
      radarRunResultSchema.safeParse({ ...run, status: "PARTIAL", failureCode: "TIMEOUT" }).success,
    ).toBe(true);
    expect(
      radarRunResultSchema.safeParse({
        ...run,
        status: "FAILED",
        observations: [],
        failureCode: "AUTH",
      }).success,
    ).toBe(true);
  });
  it.each([
    { observations: [] },
    { truncated: true },
    { status: "EMPTY_VALID" },
    { status: "EMPTY_VALID", observations: [], failureCode: "AUTH" },
    { status: "FAILED", observations: [] },
    { status: "FAILED", failureCode: "AUTH" },
    { status: "PARTIAL" },
    { observations: [{ ...sample, source: "NAVER_SEARCH" }] },
    { observations: [{ ...sample, sampledAt: "2026-09-19T02:00:00Z" }] },
  ])("rejects misleading result metadata: %j", (patch) => {
    expect(radarRunResultSchema.safeParse({ ...run, ...patch }).success).toBe(false);
  });
});

describe("Radar event time precision", () => {
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    topicIds: ["00000000-0000-4000-8000-000000000002"],
    title: "사건",
    occurredAt: null,
    timePrecision: "UNKNOWN",
  };
  it("does not manufacture an event date from observation time", () => {
    expect(radarEventSchema.safeParse(event).success).toBe(true);
    expect(radarEventSchema.safeParse({ ...event, timePrecision: "EXACT" }).success).toBe(false);
    expect(radarEventSchema.safeParse({ ...event, occurredAt: sample.sampledAt }).success).toBe(
      false,
    );
    expect(
      radarEventSchema.safeParse({ ...event, occurredAt: sample.sampledAt, timePrecision: "EXACT" })
        .success,
    ).toBe(true);
  });
});

describe("Radar question linkage", () => {
  const link = {
    eventId: "00000000-0000-4000-8000-000000000001",
    issueId: "00000000-0000-4000-8000-000000000002",
    issueVersion: 1,
  };
  it("uses the existing composite question version key", () => {
    expect(radarIssueLinkSchema.safeParse(link).success).toBe(true);
    expect(radarIssueLinkSchema.safeParse({ ...link, issueVersion: 0 }).success).toBe(false);
    expect(radarIssueLinkSchema.safeParse({ ...link, issueVersion: 2147483648 }).success).toBe(
      false,
    );
    expect(radarIssueLinkSchema.safeParse({ ...link, issueVersionId: link.issueId }).success).toBe(
      false,
    );
  });
});
