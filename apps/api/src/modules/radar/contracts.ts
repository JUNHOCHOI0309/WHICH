import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const radarSourceSchema = z.enum([
  "GOOGLE_TRENDING_RSS",
  "NAVER_SEARCH",
  "NAVER_DATALAB",
  "YOUTUBE_DATA_API",
]);

// This is link validation, not permission to fetch a URL. Adapters must enforce
// their own host allowlist, redirect, DNS, timeout and response-size policies.
const sourceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "An HTTPS source URL without credentials is required");

export const radarWindowSchema = z
  .strictObject({
    start: timestamp,
    end: timestamp,
    granularity: z.enum(["SNAPSHOT", "HOUR", "DAY", "WEEK", "MONTH"]),
  })
  .refine((value) => Date.parse(value.start) <= Date.parse(value.end), {
    message: "Window end must not precede start",
  });

export const radarMetricSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("COUNT"),
    value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
  z.strictObject({
    kind: z.literal("RELATIVE_INDEX"),
    value: z.number().min(0).max(100).nullable(),
    // A 0–100 series is only comparable inside its provider-defined cohort.
    comparisonKey: text,
  }),
  z.strictObject({
    kind: z.literal("LOWER_BOUND"),
    value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
  z.strictObject({
    kind: z.literal("RANK"),
    value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    comparisonKey: text,
  }),
]);

export const radarObservationSchema = z.strictObject({
  source: radarSourceSchema,
  sourceItemId: text,
  sourceUrl,
  title: text,
  metricName: text,
  scope: z.strictObject({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    queryKey: text,
    // Includes category/device/filters where applicable; never implicit.
    dimensionsKey: text,
  }),
  window: radarWindowSchema,
  // Fixed for a logical collection run, including retries of that run.
  sampledAt: timestamp,
  // Provider's data timestamp, not fabricated from our fetch time.
  sourceUpdatedAt: timestamp.nullable(),
  metric: radarMetricSchema,
});

export type RadarObservation = z.infer<typeof radarObservationSchema>;

export const radarRunResultSchema = z
  .strictObject({
    source: radarSourceSchema,
    sampledAt: timestamp,
    status: z.enum(["SUCCEEDED", "EMPTY_VALID", "PARTIAL", "FAILED"]),
    observations: z.array(radarObservationSchema).max(10000),
    failureCode: z
      .enum(["RATE_LIMIT", "TIMEOUT", "AUTH", "UPSTREAM", "INVALID_RESPONSE"])
      .nullable(),
    truncated: z.boolean(),
  })
  .superRefine((run, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      run.status === "SUCCEEDED" &&
      (!run.observations.length || run.failureCode || run.truncated)
    ) {
      invalid("Success requires observations and complete coverage without failure");
    }
    if (
      run.status === "EMPTY_VALID" &&
      (run.observations.length || run.failureCode || run.truncated)
    ) {
      invalid("A valid empty result requires complete coverage without failure");
    }
    if (run.status === "FAILED" && (!run.failureCode || run.observations.length || run.truncated)) {
      invalid("Failure requires a cause and no accepted observations; use PARTIAL otherwise");
    }
    if (run.status === "PARTIAL" && !run.failureCode && !run.truncated) {
      invalid("Partial results must identify failed or truncated coverage");
    }
    if (
      run.observations.some(
        (item) => item.source !== run.source || item.sampledAt !== run.sampledAt,
      )
    ) {
      invalid("Observations must belong to this source and collection sample");
    }
  });

export type RadarRunResult = z.infer<typeof radarRunResultSchema>;

// Distinct concepts: a long-lived topic, a dated event, a cited claim, and a
// versioned WHICH question. Database referential integrity is implemented in R03.
export const radarTopicSchema = z.strictObject({ id: z.uuid(), name: text });
export const radarEventSchema = z
  .strictObject({
    id: z.uuid(),
    topicIds: z.array(z.uuid()).min(1),
    title: text,
    occurredAt: timestamp.nullable(),
    timePrecision: z.enum(["EXACT", "DAY", "UNKNOWN"]),
  })
  .refine((event) => (event.occurredAt === null) === (event.timePrecision === "UNKNOWN"), {
    message: "Unknown event time requires null; known time requires explicit precision",
  });
export const radarEvidenceSchema = z.strictObject({
  id: z.uuid(),
  eventId: z.uuid(),
  source: radarSourceSchema,
  sourceUrl,
  claim: text,
  publishedAt: timestamp.nullable(),
  observedAt: timestamp,
  status: z.enum(["SUPPORTED", "PARTIAL", "CONFLICTED", "UNKNOWN", "RETRACTED"]),
});
export const radarIssueLinkSchema = z.strictObject({
  eventId: z.uuid(),
  issueId: z.uuid(),
  // Existing WHICH issue_versions uses (issueId, version), not a version UUID.
  issueVersion: z.number().int().positive().max(2147483647),
});
