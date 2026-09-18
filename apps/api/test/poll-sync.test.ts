import { describe, expect, it, vi } from "vitest";
import { pollSyncDay, pollSyncSettings } from "../src/modules/operations/poll-sync-config.js";
import {
  createOctoparsePollClient,
  parsePollExport,
} from "../src/modules/operations/octoparse-polls.js";

const config = {
  taskId: "task-real",
  apiKey: "test-secret",
  memberId: "00000000-0000-4000-8000-000000000001",
  exportHosts: ["export.example.com"],
};
const row = {
  Channel_name: "진행빵집",
  Post_URL: "https://www.youtube.com/post/UgkxDailyTest123",
  Post_text: "어디로 갈까요?",
  Poll_options: ["집", "산", "바다", "공원"],
  Poll_vote_count: "1.2만명 투표",
  Post_date: "2 days ago",
};
const json = (data: unknown) => new Response(JSON.stringify(data));
describe("daily poll sync", () => {
  it("is due only from 08:00 KST, including UTC date rollover", () => {
    expect(pollSyncDay(new Date("2026-09-18T22:59:59Z"))).toBeNull();
    expect(pollSyncDay(new Date("2026-09-18T23:00:00Z"))).toBe("2026-09-19");
    expect(pollSyncDay(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  });
  it("requires credentials AND real mapping verification and an explicit enable flag", () => {
    expect(pollSyncSettings({ POLL_SYNC_ENABLED: "true" }).enabled).toBe(false);
    const env = {
      OCTOPARSE_TASK_ID: config.taskId,
      OCTOPARSE_API_KEY: config.apiKey,
      OCTOPARSE_IMPORT_MEMBER_ID: config.memberId,
      OCTOPARSE_EXPORT_HOSTS: config.exportHosts.join(","),
    };
    expect(pollSyncSettings(env).configured).toBe(false);
    expect(pollSyncSettings({ ...env, OCTOPARSE_MAPPING_VERIFIED: "true" })).toMatchObject({
      configured: true,
      enabled: false,
    });
  });
  it("preserves all options, raw source and relative dates without guessing", () => {
    expect(parsePollExport([row])[0]).toMatchObject({
      source: {
        originalChoices: row.Poll_options,
        observedDate: null,
        participationText: row.Poll_vote_count,
      },
      raw: row,
    });
    expect(() => parsePollExport([{ ...row, Poll_options: "집, 산, 바다, 공원" }])).toThrow();
    expect(() => parsePollExport([{ ...row, Channel_name: "만렙백수" }])).toThrow(
      "CHANNEL_NOT_CONFIRMED",
    );
  });
  it("honors waiting guidance and never treats preview data as a full export", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ data: { status: "collecting", retryGuidance: { waitSecondsMin: 95 } } }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            status: "exported",
            taskId: config.taskId,
            dataTotal: 2,
            sampleData: [row],
            exportFileUrl: "https://export.example.com/signed",
          },
        }),
      )
      .mockResolvedValueOnce(json([row]));
    const client = createOctoparsePollClient(config, request);
    expect(await client.read(new AbortController().signal)).toEqual({
      status: "WAITING",
      waitMs: 95000,
    });
    await expect(client.read(new AbortController().signal)).rejects.toThrow("EXPORT_INCOMPLETE");
    expect(request.mock.calls[2]?.[1]?.headers).toBeUndefined();
    expect(request.mock.calls[2]?.[1]?.redirect).toBe("error");
  });
  it("downloads only an approved HTTPS host and no credential is forwarded", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        data: { status: "exported", dataTotal: 1, exportFileUrl: "https://127.0.0.1/admin" },
      }),
    );
    await expect(
      createOctoparsePollClient(config, request).read(new AbortController().signal),
    ).rejects.toThrow("EXPORT_HOST_NOT_ALLOWED");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("requires its own accepted start rather than borrowing an already-running task", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: { status: "already_running" } }));
    await expect(
      createOctoparsePollClient(config, request).start(new AbortController().signal),
    ).rejects.toThrow("TASK_ALREADY_RUNNING");
  });
  it("rejects no-data and provider errors without leaking response content", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("sensitive details", { status: 401 }))
      .mockResolvedValueOnce(json({ data: { status: "no_data" } }));
    const client = createOctoparsePollClient(config, request);
    await expect(client.read(new AbortController().signal)).rejects.toThrow("AUTH_FAILED");
    await expect(client.read(new AbortController().signal)).rejects.toThrow(
      "SOURCE_NO_DATA_REVIEW_REQUIRED",
    );
  });
});
