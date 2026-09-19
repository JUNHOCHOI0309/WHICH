import { z } from "zod";

import { classifyRadarHttpFailure, RadarIngestionFailure } from "../../ingestion-service.js";

export const YOUTUBE_DATA_API_ORIGIN = "https://www.googleapis.com";
export const YOUTUBE_DATA_API_LIMITS = Object.freeze({
  timeoutMilliseconds: 5_000,
  maxResponseBytes: 524_288,
});

const apiKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim() && !/[\s\0]/u.test(value));
const credentialsSchema = z.strictObject({ apiKey: apiKeySchema });
const bodyChunkSchema = z.object({
  done: z.boolean(),
  value: z.instanceof(Uint8Array).optional(),
});
const errorSchema = z.object({
  error: z.object({
    errors: z
      .array(z.object({ reason: z.string().max(100) }))
      .max(20)
      .optional(),
  }),
});

export type YouTubeDataApiCredentials = z.infer<typeof credentialsSchema>;
export type YouTubeFetch = (input: string, init: RequestInit) => Promise<Response>;
export type YouTubeRequestContext = {
  signal: AbortSignal;
  request<T>(
    operation: string,
    requestKey: string,
    perform: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

type JsonRequestOptions = {
  context: YouTubeRequestContext;
  operation: "search.list" | "videos.list";
  requestKey: string;
  path: "/youtube/v3/search" | "/youtube/v3/videos";
  parameters: Readonly<Record<string, string>>;
  credentials?: YouTubeDataApiCredentials;
  fetchImpl?: YouTubeFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

export function invalidYouTubeResponse() {
  return new RadarIngestionFailure("INVALID_RESPONSE", false);
}

export function loadYouTubeDataApiCredentials(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): YouTubeDataApiCredentials {
  const parsed = credentialsSchema.safeParse({ apiKey: environment.YOUTUBE_DATA_API_KEY });
  if (!parsed.success) throw new RadarIngestionFailure("AUTH", false);
  return parsed.data;
}

function parseCredentials(input: YouTubeDataApiCredentials | undefined) {
  if (!input) return loadYouTubeDataApiCredentials();
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) throw new RadarIngestionFailure("AUTH", false);
  return parsed.data;
}

function retryAfterMilliseconds(value: string | null, at: Date) {
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Math.min(Number(value) * 1_000, 86_400_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - at.getTime());
}

async function readLimitedJson(response: Response, maxResponseBytes: number) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxResponseBytes)
  ) {
    throw invalidYouTubeResponse();
  }
  if (!response.body) throw invalidYouTubeResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let body = "";
  try {
    while (true) {
      const rawChunk: unknown = await reader.read();
      const { value, done } = bodyChunkSchema.parse(rawChunk);
      if (done) break;
      if (!value) throw invalidYouTubeResponse();
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw invalidYouTubeResponse();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof RadarIngestionFailure) throw error;
    throw invalidYouTubeResponse();
  }
  if (!body.trim()) throw invalidYouTubeResponse();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw invalidYouTubeResponse();
  }
}

function classifyYouTubeFailure(status: number, payload: unknown, retryAfter: number | null) {
  if (status === 403) {
    const parsed = errorSchema.safeParse(payload);
    const reasons = new Set(
      parsed.success ? parsed.data.error.errors?.map((item) => item.reason) : [],
    );
    if (reasons.has("rateLimitExceeded") || reasons.has("userRateLimitExceeded")) {
      return new RadarIngestionFailure("RATE_LIMIT", true, status, retryAfter);
    }
    if (reasons.has("quotaExceeded") || reasons.has("dailyLimitExceeded")) {
      return new RadarIngestionFailure("RATE_LIMIT", false, status, retryAfter);
    }
  }
  return classifyRadarHttpFailure(status, retryAfter);
}

export async function requestYouTubeDataApiJson(options: JsonRequestOptions) {
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? YOUTUBE_DATA_API_LIMITS.timeoutMilliseconds;
  const maxResponseBytes = options.maxResponseBytes ?? YOUTUBE_DATA_API_LIMITS.maxResponseBytes;
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error("INVALID_YOUTUBE_TIMEOUT");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error("INVALID_YOUTUBE_SIZE_LIMIT");
  }
  const credentials = parseCredentials(options.credentials);
  if (
    (options.operation === "search.list" && options.path !== "/youtube/v3/search") ||
    (options.operation === "videos.list" && options.path !== "/youtube/v3/videos")
  ) {
    throw new Error("INVALID_YOUTUBE_ENDPOINT");
  }
  const expectedUrl = new URL(options.path, YOUTUBE_DATA_API_ORIGIN);
  for (const [name, value] of Object.entries(options.parameters)) {
    expectedUrl.searchParams.set(name, value);
  }
  expectedUrl.searchParams.set("key", credentials.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return options.context.request(options.operation, options.requestKey, async (parentSignal) => {
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
      const response = await fetchImpl(expectedUrl.href, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": "WHICH-Radar/1.0" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.redirected || (response.url && response.url !== expectedUrl.href)) {
        throw invalidYouTubeResponse();
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (response.status !== 200) {
        let payload: unknown = null;
        if (contentType === "application/json" && response.body) {
          try {
            payload = await readLimitedJson(response, maxResponseBytes);
          } catch {
            payload = null;
          }
        }
        throw classifyYouTubeFailure(
          response.status,
          payload,
          retryAfterMilliseconds(response.headers.get("retry-after"), requestedAt),
        );
      }
      if (contentType !== "application/json") throw invalidYouTubeResponse();
      const payload = await readLimitedJson(response, maxResponseBytes);
      return { payload, fetchedAt: now().toISOString() };
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
