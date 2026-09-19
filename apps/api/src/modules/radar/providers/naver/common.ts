import { z } from "zod";

import { classifyRadarHttpFailure, RadarIngestionFailure } from "../../ingestion-service.js";

export const NAVER_API_HUB_ORIGIN = "https://naverapihub.apigw.ntruss.com";
export const NAVER_API_HUB_LIMITS = Object.freeze({
  timeoutMilliseconds: 5_000,
  maxResponseBytes: 524_288,
});

const credential = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim() && !/[\r\n\0]/u.test(value));
const credentialsSchema = z.strictObject({
  clientId: credential,
  clientSecret: credential,
});
const bodyChunkSchema = z.object({
  done: z.boolean(),
  value: z.instanceof(Uint8Array).optional(),
});

export type NaverApiHubCredentials = z.infer<typeof credentialsSchema>;
export type NaverFetch = (input: string, init: RequestInit) => Promise<Response>;
export type NaverRequestContext = {
  signal: AbortSignal;
  request<T>(
    operation: string,
    requestKey: string,
    perform: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

type JsonRequestOptions = {
  context: NaverRequestContext;
  operation: "news.search" | "search.trend";
  requestKey: string;
  url: string;
  method: "GET" | "POST";
  credentials?: NaverApiHubCredentials;
  body?: string;
  fetchImpl?: NaverFetch;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  now?: () => Date;
};

export function invalidNaverResponse() {
  return new RadarIngestionFailure("INVALID_RESPONSE", false);
}

export function loadNaverApiHubCredentials(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NaverApiHubCredentials {
  const parsed = credentialsSchema.safeParse({
    clientId: environment.NAVER_API_HUB_CLIENT_ID,
    clientSecret: environment.NAVER_API_HUB_CLIENT_SECRET,
  });
  if (!parsed.success) throw new RadarIngestionFailure("AUTH", false);
  return parsed.data;
}

function parseCredentials(input: NaverApiHubCredentials | undefined) {
  if (!input) return loadNaverApiHubCredentials();
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
    throw invalidNaverResponse();
  }
  if (!response.body) throw invalidNaverResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let body = "";
  try {
    while (true) {
      const rawChunk: unknown = await reader.read();
      const { value, done } = bodyChunkSchema.parse(rawChunk);
      if (done) break;
      if (!value) throw invalidNaverResponse();
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw invalidNaverResponse();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof RadarIngestionFailure) throw error;
    throw invalidNaverResponse();
  }
  if (!body.trim()) throw invalidNaverResponse();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw invalidNaverResponse();
  }
}

export async function requestNaverApiHubJson(options: JsonRequestOptions) {
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? NAVER_API_HUB_LIMITS.timeoutMilliseconds;
  const maxResponseBytes = options.maxResponseBytes ?? NAVER_API_HUB_LIMITS.maxResponseBytes;
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error("INVALID_NAVER_TIMEOUT");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error("INVALID_NAVER_SIZE_LIMIT");
  }
  const credentials = parseCredentials(options.credentials);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const expectedUrl = new URL(options.url);
  if (
    expectedUrl.origin !== NAVER_API_HUB_ORIGIN ||
    expectedUrl.username ||
    expectedUrl.password ||
    expectedUrl.hash
  ) {
    throw new Error("INVALID_NAVER_ENDPOINT");
  }

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
      const headers = new Headers({
        accept: "application/json",
        "user-agent": "WHICH-Radar/1.0",
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret,
      });
      if (options.body !== undefined) headers.set("content-type", "application/json");
      const response = await fetchImpl(expectedUrl.href, {
        method: options.method,
        headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw classifyRadarHttpFailure(
          response.status,
          retryAfterMilliseconds(response.headers.get("retry-after"), requestedAt),
        );
      }
      if (response.redirected || (response.url && response.url !== expectedUrl.href)) {
        throw invalidNaverResponse();
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") throw invalidNaverResponse();
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
