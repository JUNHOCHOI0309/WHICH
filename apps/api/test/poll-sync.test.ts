import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollSyncDay, pollSyncSettings } from "../src/modules/operations/poll-sync-config.js";
import {
  createYouTubePollCollector,
  parseYouTubePoll,
  publicYouTubeFetch,
} from "../src/modules/operations/youtube-polls.js";
import { POLL_CHANNEL_REGISTER } from "../src/modules/operations/poll-channels.js";
const mocks = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn(), channel: vi.fn() }));
vi.mock("youtubei.js", () => ({
  Innertube: { create: mocks.create },
  Log: { setLevel: vi.fn(), Level: { NONE: 0 } },
}));
const channel = POLL_CHANNEL_REGISTER[0];
const id = channel.channelId;
const text = (s: string) => ({ toString: () => s });
const post = () => ({
  type: "BackstagePost",
  id: "UgkxTest1234567",
  author: { id },
  content: text("어느 쪽?"),
  published: text("3일 전"),
  attachment: {
    type: "Poll",
    choices: [{ text: text("집") }, { text: text("산") }],
    total_votes: text("5.7만명 투표"),
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ resolveURL: mocks.resolve, getChannel: mocks.channel });
  mocks.resolve.mockResolvedValue({ payload: { browseId: id } });
});
describe("YouTube.js poll source", () => {
  it("keeps Korea 08:00 boundary and explicit verification/activation gates without API keys", () => {
    expect(pollSyncDay(new Date("2026-09-18T22:59:59Z"))).toBeNull();
    expect(pollSyncDay(new Date("2026-09-18T23:00:00Z"))).toBe("2026-09-19");
    const env = {
      POLL_SYNC_IMPORT_MEMBER_ID: "00000000-0000-4000-8000-000000000001",
      POLL_SYNC_SOURCE_VERIFIED: "true",
      POLL_SYNC_ENABLED: "true",
    };
    expect(pollSyncSettings(env)).toMatchObject({
      configured: true,
      enabled: true,
      config: { maxPages: 5 },
    });
    expect(pollSyncSettings({ ...env, POLL_SYNC_SOURCE_VERIFIED: "false" }).enabled).toBe(false);
    expect(pollSyncSettings({ ...env, POLL_SYNC_MAX_PAGES: "999" }).enabled).toBe(false);
  });
  it("preserves exact choice text, displayed vote count and relative dates without inventing numbers", () => {
    expect(parseYouTubePoll(post(), channel, id)).toMatchObject({
      source: {
        originalChoices: ["집", "산"],
        participationText: "5.7만명 투표",
        observedDate: null,
      },
      raw: { publishedText: "3일 전" },
    });
    expect(
      parseYouTubePoll(
        { ...post(), attachment: { ...post().attachment, total_votes: undefined } },
        channel,
        id,
      )?.source.participationText,
    ).toBeNull();
  });
  it("rejects author changes and invalid polls, skips shared posts and non-polls", () => {
    expect(() => parseYouTubePoll({ ...post(), author: { id: "other" } }, channel, id)).toThrow(
      "POST_AUTHOR_MISMATCH",
    );
    expect(() => parseYouTubePoll({ ...post(), content: text("") }, channel, id)).toThrow(
      "POLL_SHAPE_CHANGED",
    );
    expect(parseYouTubePoll({ ...post(), type: "SharedPost" }, channel, id)).toBeNull();
    expect(parseYouTubePoll({ ...post(), attachment: null }, channel, id)).toBeNull();
  });
  it("preserves long source posts without silently truncating them", () => {
    const original = "가".repeat(1100);
    expect(
      parseYouTubePoll({ ...post(), content: text(original) }, channel, id)?.source
        .originalQuestion,
    ).toBe(original);
    expect(() =>
      parseYouTubePoll({ ...post(), content: text("가".repeat(10001)) }, channel, id),
    ).toThrow("POLL_SHAPE_CHANGED");
  });
  it("follows bounded continuation pages, deduplicates pinned posts and reports remaining history", async () => {
    const continuation = vi.fn().mockResolvedValue({
      posts: [post(), { ...post(), id: "UgkxTestSecond1234" }],
      has_continuation: true,
    });
    mocks.channel.mockResolvedValue({
      hasTabWithURL: () => true,
      getCommunity: () =>
        Promise.resolve({
          posts: [post()],
          has_continuation: true,
          getContinuation: continuation,
        }),
    });
    const result = await createYouTubePollCollector(2).collect(
      channel,
      new AbortController().signal,
    );
    expect(result.report).toMatchObject({ status: "OK", pages: 2, polls: 2, hasMore: true });
    expect(result.rows).toHaveLength(2);
    expect(continuation).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ retrieve_player: false, enable_session_cache: false }),
    );
  });
  it("holds unconfirmed identities, rejects changed handles and safely reports missing tabs", async () => {
    expect(
      (
        await createYouTubePollCollector().collect(
          POLL_CHANNEL_REGISTER[3],
          new AbortController().signal,
        )
      ).report.status,
    ).toBe("HELD");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValueOnce({ payload: { browseId: "UCun14pE-GmXEd1qB9FLuQHA" } });
    expect(
      (await createYouTubePollCollector().collect(channel, new AbortController().signal)).report
        .errorCode,
    ).toBe("CHANNEL_ID_MISMATCH");
    mocks.channel.mockResolvedValue({ hasTabWithURL: () => false });
    expect(
      (await createYouTubePollCollector().collect(channel, new AbortController().signal)).report
        .errorCode,
    ).toBe("POSTS_TAB_UNAVAILABLE");
  });
  it("does not mark changed/empty renderers or failed continuation as healthy zero", async () => {
    mocks.channel.mockResolvedValue({
      hasTabWithURL: () => true,
      getCommunity: () => Promise.resolve({ posts: [], has_continuation: false }),
    });
    expect(
      (await createYouTubePollCollector().collect(channel, new AbortController().signal)).report
        .errorCode,
    ).toBe("POSTS_EMPTY_REVIEW_REQUIRED");
    mocks.channel.mockResolvedValue({
      hasTabWithURL: () => true,
      getCommunity: () =>
        Promise.resolve({
          posts: [post()],
          has_continuation: true,
          getContinuation: () => Promise.reject(new Error("private details")),
        }),
    });
    const failed = await createYouTubePollCollector(2).collect(
      channel,
      new AbortController().signal,
    );
    expect(failed.rows).toEqual([]);
    expect(failed.report.errorCode).toBe("SOURCE_READ_FAILED");
  });
  it("allows valid non-poll pages as zero polls", async () => {
    mocks.channel.mockResolvedValue({
      hasTabWithURL: () => true,
      getCommunity: () =>
        Promise.resolve({
          posts: [{ ...post(), attachment: null }],
          has_continuation: false,
        }),
    });
    expect(
      (await createYouTubePollCollector().collect(channel, new AbortController().signal)).report,
    ).toMatchObject({ status: "OK", polls: 0, skipped: 1 });
  });
  it("restricts hosts, redirects, credentials, response size and request count", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    const read = publicYouTubeFetch(new AbortController().signal, request);
    await expect(read("http://localhost/private")).rejects.toThrow("SOURCE_HOST_NOT_ALLOWED");
    await read("https://www.youtube.com/test", {
      headers: { cookie: "secret", authorization: "secret" },
    });
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has("cookie")).toBe(false);
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    for (let i = 1; i < 16; i++) await read("https://www.youtube.com/test");
    await expect(read("https://www.youtube.com/test")).rejects.toThrow("SOURCE_REQUEST_LIMIT");
    const huge = publicYouTubeFetch(
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(8_000_001))),
    );
    await expect(huge("https://www.youtube.com/test")).rejects.toThrow("SOURCE_BODY_TOO_LARGE");
    const limited = publicYouTubeFetch(
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("limited", { status: 429 })),
    );
    await expect(limited("https://www.youtube.com/test")).rejects.toThrow("SOURCE_RATE_LIMITED");
  });
});
