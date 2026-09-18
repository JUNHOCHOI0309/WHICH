import { z } from "zod";
import { normalizePollRow } from "./poll-candidates.js";
import type { PollSyncConfig } from "./poll-sync-config.js";
import { POLL_CHANNEL_REGISTER } from "./poll-channels.js";

export class PollSyncError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const object = z.record(z.string(), z.unknown());
const envelope = z.object({
  data: z
    .object({
      success: z.boolean().optional(),
      status: z.string(),
      taskId: z.string().optional(),
      exportFileUrl: z.string().optional(),
      dataTotal: z.number().int().min(0).optional(),
      retryGuidance: z
        .object({ waitSecondsMin: z.number().min(0).optional() })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

// Strict on purpose: confirm actual Poll_options shape before enabling the adapter.
export function parsePollExport(input: unknown) {
  const rows = z.array(object).min(1).max(5000).parse(input);
  return rows.map((raw) => {
    const source = normalizePollRow(
      "Post_URL" in raw
        ? {
            channel: raw.Channel_name,
            sourceUrl: raw.Post_URL,
            originalQuestion: raw.Post_text,
            originalChoices: raw.Poll_options,
            participationText:
              raw.Poll_vote_count == null
                ? null
                : String(z.union([z.string(), z.number()]).parse(raw.Poll_vote_count)),
            observedDate:
              typeof raw.Post_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.Post_date)
                ? raw.Post_date
                : null,
          }
        : raw,
    );
    const channel = POLL_CHANNEL_REGISTER.find((item) => item.name === source.channel);
    if (!channel?.initialBatchEligible) throw new PollSyncError("CHANNEL_NOT_CONFIRMED");
    if (source.channelId && channel.channelId && source.channelId !== channel.channelId)
      throw new PollSyncError("CHANNEL_ID_MISMATCH");
    return { source, raw };
  });
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new PollSyncError("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk: { done: boolean; value?: unknown } = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!(value instanceof Uint8Array)) throw new PollSyncError("EXPORT_ENCODING_INVALID");
      length += value.length;
      if (length > maxBytes) throw new PollSyncError("EXPORT_TOO_LARGE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createOctoparsePollClient(config: PollSyncConfig, request: typeof fetch = fetch) {
  async function call(path: string, signal: AbortSignal, body?: unknown) {
    const response = await request(`https://openapi.octoparse.com/api/agentTools/${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: { "x-api-key": config.apiKey, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok)
      throw new PollSyncError(
        response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "PROVIDER_HTTP_FAILED",
      );
    const parsed = envelope.safeParse(await boundedJson(response, 1_000_000));
    if (!parsed.success || parsed.data.data.success === false)
      throw new PollSyncError("PROVIDER_RESPONSE_INVALID");
    if (parsed.data.data.taskId && parsed.data.data.taskId !== config.taskId)
      throw new PollSyncError("TASK_ID_MISMATCH");
    return parsed.data.data;
  }
  return {
    async start(signal: AbortSignal) {
      const data = await call("startOrStopTask", signal, {
        taskId: config.taskId,
        action: "start",
      });
      if (data.status !== "start_requested")
        throw new PollSyncError(
          data.status === "already_running" ? "TASK_ALREADY_RUNNING" : "START_REJECTED",
        );
    },
    async read(signal: AbortSignal) {
      const data = await call(
        `exportData?taskId=${encodeURIComponent(config.taskId)}&exportFileType=JSON&previewRows=0`,
        signal,
      );
      if (["collecting", "exporting"].includes(data.status))
        return {
          status: "WAITING" as const,
          waitMs: Math.max(60, data.retryGuidance?.waitSecondsMin ?? 60) * 1000,
        };
      if (data.status === "no_data") throw new PollSyncError("SOURCE_NO_DATA_REVIEW_REQUIRED");
      if (data.status !== "exported" || !data.exportFileUrl)
        throw new PollSyncError("SOURCE_FAILED");
      const url = new URL(data.exportFileUrl);
      // An exact, operator-verified export host is required. Never forward the API key or follow redirects.
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !config.exportHosts.includes(url.hostname)
      )
        throw new PollSyncError("EXPORT_HOST_NOT_ALLOWED");
      const response = await request(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new PollSyncError("EXPORT_DOWNLOAD_FAILED");
      const raw = await boundedJson(response, 10_000_000);
      if (!Array.isArray(raw) || data.dataTotal === undefined || data.dataTotal !== raw.length)
        throw new PollSyncError("EXPORT_INCOMPLETE");
      try {
        return { status: "READY" as const, rows: parsePollExport(raw) };
      } catch (error) {
        if (error instanceof PollSyncError) throw error;
        throw new PollSyncError("EXPORT_MAPPING_INVALID");
      }
    },
  };
}
export type OctoparsePollClient = ReturnType<typeof createOctoparsePollClient>;
