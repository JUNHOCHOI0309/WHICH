import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { normalizePollRow } from "./poll-candidates.js";
import type { POLL_CHANNEL_REGISTER } from "./poll-channels.js";

export const POLL_SOURCE_ID = "youtubei.js:18.0.0:v1";
export type PollChannel = (typeof POLL_CHANNEL_REGISTER)[number];
export class PollSyncError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export type CollectedPoll = {
  source: ReturnType<typeof normalizePollRow>;
  raw: Record<string, unknown>;
};
export type ChannelReport = {
  channel: string;
  channelId?: string;
  status: "OK" | "FAILED" | "HELD";
  pages: number;
  posts: number;
  polls: number;
  skipped: number;
  hasMore: boolean;
  errorCode?: string;
  imported?: number;
  duplicates?: number;
};
export type ChannelCollection = { report: ChannelReport; rows: CollectedPoll[] };
export type PollCollector = {
  collect: (channel: PollChannel, signal: AbortSignal) => Promise<ChannelCollection>;
};

// Only these public fields cross the source boundary. No vote endpoints, cookies or account data.
type PublicPost = {
  type?: string;
  id?: string;
  author?: { id?: string };
  content?: { toString(): string };
  published?: { toString(): string };
  attachment?: {
    type?: string;
    choices?: Array<{ text?: { toString(): string } }>;
    total_votes?: { toString(): string };
  } | null;
};
export function parseYouTubePoll(
  post: PublicPost,
  channel: PollChannel,
  channelId: string,
): CollectedPoll | null {
  if (post.type === "SharedPost" || post.attachment?.type !== "Poll") return null;
  if (post.author?.id !== channelId) throw new PollSyncError("POST_AUTHOR_MISMATCH");
  try {
    const postId = z
      .string()
      .regex(/^[A-Za-z0-9_-]{10,100}$/)
      .parse(post.id);
    const source = normalizePollRow({
      channel: channel.name,
      channelId,
      sourceUrl: `https://www.youtube.com/post/${postId}`,
      originalQuestion: post.content?.toString(),
      originalChoices: post.attachment.choices?.map((c) => c.text?.toString()),
      participationText: post.attachment.total_votes?.toString() || null,
      observedDate: null,
    });
    return {
      source,
      raw: { provider: POLL_SOURCE_ID, publishedText: post.published?.toString() ?? null },
    };
  } catch {
    throw new PollSyncError("POLL_SHAPE_CHANGED");
  }
}

// Read-only, anonymous requests; reject redirects and arbitrary endpoints. Bound bodies as well as time.
export function publicYouTubeFetch(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): typeof fetch {
  let requests = 0;
  return async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["www.youtube.com", "youtube.com", "youtubei.googleapis.com"].includes(url.hostname)
    )
      throw new PollSyncError("SOURCE_HOST_NOT_ALLOWED");
    if (++requests > 16) throw new PollSyncError("SOURCE_REQUEST_LIMIT");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.delete("cookie");
    headers.delete("authorization");
    const abort = AbortSignal.any([
      signal,
      AbortSignal.timeout(20_000),
      ...(init.signal ? [init.signal] : []),
    ]);
    const response = await request(input, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
      signal: abort,
    });
    if (!response.ok)
      throw new PollSyncError(
        response.status === 429 ? "SOURCE_RATE_LIMITED" : "SOURCE_HTTP_FAILED",
      );
    if (!response.body) throw new PollSyncError("SOURCE_EMPTY_BODY");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        abort.throwIfAborted();
        const part: { done: boolean; value?: unknown } = await reader.read();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw new PollSyncError("SOURCE_ENCODING_INVALID");
        length += part.value.length;
        if (length > 8_000_000) throw new PollSyncError("SOURCE_BODY_TOO_LARGE");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const resultHeaders = new Headers(response.headers);
    resultHeaders.delete("content-encoding");
    resultHeaders.delete("content-length");
    resultHeaders.delete("set-cookie");
    return new Response(Buffer.concat(chunks), { status: response.status, headers: resultHeaders });
  };
}

export function createYouTubePollCollector(maxPages = 5): PollCollector {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
    throw new PollSyncError("PAGE_LIMIT_INVALID");
  return {
    async collect(channel, parentSignal) {
      const report: ChannelReport = {
        channel: channel.name,
        status: "OK",
        pages: 0,
        posts: 0,
        polls: 0,
        skipped: 0,
        hasMore: false,
      };
      if (!channel.initialBatchEligible) return { report: { ...report, status: "HELD" }, rows: [] };
      const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(90_000)]);
      const rows: CollectedPoll[] = [];
      const seen = new Set<string>();
      try {
        const { Innertube, Log } = await import("youtubei.js");
        // Parser diagnostics can include raw responses. Surface only our safe channel/error report.
        Log.setLevel(Log.Level.NONE);
        const yt = await Innertube.create({
          lang: "ko",
          location: "KR",
          retrieve_player: false,
          enable_session_cache: false,
          fetch: publicYouTubeFetch(signal),
        });
        const endpoint = await yt.resolveURL(channel.channelUrl);
        const { browseId: id } = z
          .object({ browseId: z.string().regex(/^UC[\w-]{22}$/) })
          .parse(endpoint.payload as unknown);
        if (channel.channelId && channel.channelId !== id)
          throw new PollSyncError("CHANNEL_ID_MISMATCH");
        report.channelId = id;
        const info = await yt.getChannel(id);
        if (!info.hasTabWithURL("posts")) throw new PollSyncError("POSTS_TAB_UNAVAILABLE");
        let page:
          | Awaited<ReturnType<typeof info.getCommunity>>
          | Awaited<ReturnType<typeof info.getContinuation>> = await info.getCommunity();
        for (let i = 0; i < maxPages; i++) {
          signal.throwIfAborted();
          if (!page.posts.length) throw new PollSyncError("POSTS_EMPTY_REVIEW_REQUIRED");
          report.pages++;
          report.posts += page.posts.length;
          for (const post of page.posts) {
            const row = parseYouTubePoll(post, channel, id);
            if (!row) {
              report.skipped++;
              continue;
            }
            if (!seen.has(row.source.postId)) {
              seen.add(row.source.postId);
              rows.push(row);
            }
          }
          report.hasMore = page.has_continuation;
          if (!report.hasMore || i === maxPages - 1) break;
          await delay(500, undefined, { signal });
          page = await page.getContinuation();
        }
        // An empty parsed page can also mean a changed renderer: never call it a healthy zero.
        if (!report.posts) throw new PollSyncError("POSTS_EMPTY_REVIEW_REQUIRED");
        report.polls = rows.length;
        return { report, rows };
      } catch (error) {
        return {
          report: {
            ...report,
            status: "FAILED",
            errorCode:
              error instanceof PollSyncError
                ? error.code
                : signal.aborted
                  ? "SOURCE_TIMEOUT"
                  : "SOURCE_READ_FAILED",
          },
          rows: [],
        };
      }
    },
  };
}
