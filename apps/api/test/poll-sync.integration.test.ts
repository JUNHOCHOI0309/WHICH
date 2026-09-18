import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers/test-database.js";
import {
  members,
  operatorAccessGrants,
  operatorPollCandidates,
  operatorPollSyncRuns,
} from "../src/database/schema/index.js";
import { runDailyPollSync } from "../src/modules/operations/poll-sync.js";
import { normalizePollRow } from "../src/modules/operations/poll-candidates.js";
import { readPollSyncStatus } from "../src/modules/operations/poll-sync-status.js";
import { type PollCollector } from "../src/modules/operations/youtube-polls.js";
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let env: NodeJS.ProcessEnv;
const now = new Date("2026-09-18T23:00:00Z");
const source = normalizePollRow({
  channel: "진행빵집",
  sourceUrl: "https://www.youtube.com/post/UgkxDaily123456",
  originalQuestion: "어느 쪽인가요?",
  originalChoices: ["집", "산"],
});
function provider() {
  return {
    collect: vi.fn<PollCollector["collect"]>().mockImplementation((channel) =>
      Promise.resolve({
        report: {
          channel: channel.name,
          status: "OK",
          pages: 1,
          posts: 1,
          polls: channel.name === "진행빵집" ? 1 : 0,
          skipped: 0,
          hasMore: false,
        },
        rows: channel.name === "진행빵집" ? [{ source, raw: { original: true } }] : [],
      }),
    ),
  };
}
const wait = () => Promise.resolve();
beforeAll(async () => {
  testDb = await createTestDatabase();
  const [member] = await testDb.database.db
    .insert(members)
    .values({ displayName: "Test sync operator" })
    .returning();
  await testDb.database.db
    .insert(operatorAccessGrants)
    .values({ memberId: member!.id, grantedBy: "test" });
  env = {
    POLL_SYNC_ENABLED: "true",
    POLL_SYNC_SOURCE_VERIFIED: "true",
    POLL_SYNC_IMPORT_MEMBER_ID: member!.id,
  };
}, 30000);
beforeEach(async () => {
  await testDb.database.db.delete(operatorPollSyncRuns);
  await testDb.database.db.delete(operatorPollCandidates);
});
afterAll(async () => {
  await testDb.database.close();
  await testDb.drop();
});
describe("daily YouTube import persistence", () => {
  it("imports new posts once per day without overwriting source or review state", async () => {
    const client = provider();
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "SUCCEEDED", imported: 1 });
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "ALREADY_COMPLETED" });
    await testDb.database.db.update(operatorPollCandidates).set({ status: "DISMISSED" });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-19T23:00:00Z"),
        provider: client,
        wait,
      }),
    ).toMatchObject({ imported: 0, duplicates: 1 });
    expect((await testDb.database.db.select().from(operatorPollCandidates))[0]).toMatchObject({
      status: "DISMISSED",
      source: { originalQuestion: source.originalQuestion },
    });
    expect(client.collect).toHaveBeenCalledTimes(22);
    expect(
      (await readPollSyncStatus(testDb.database.db, {})).lastSuccessfulImportAt,
    ).not.toBeNull();
  });
  it("does not call YouTube when disabled, unconfigured or before 08 KST", async () => {
    const client = provider();
    expect(await runDailyPollSync(testDb.database.db, { env: {}, provider: client })).toEqual({
      status: "NOT_CONFIGURED",
    });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env: { ...env, POLL_SYNC_ENABLED: "false" },
        provider: client,
      }),
    ).toEqual({ status: "DISABLED" });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-18T22:59:59Z"),
        provider: client,
      }),
    ).toEqual({ status: "NOT_DUE" });
    expect(client.collect).not.toHaveBeenCalled();
  });
  it("serializes simultaneous jobs", async () => {
    const client = provider();
    const result = await Promise.all([
      runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
      runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ]);
    expect(result.filter((item) => item.status === "SUCCEEDED")).toHaveLength(1);
    expect(client.collect).toHaveBeenCalledTimes(11);
  });
  it("keeps healthy channels on partial failure, exposes errors and retries only failed channels", async () => {
    const client = provider();
    const original = client.collect.getMockImplementation()!;
    client.collect.mockImplementation(async (channel, signal) =>
      channel.name === "뭉케뭉케"
        ? {
            report: {
              channel: channel.name,
              status: "FAILED",
              pages: 0,
              posts: 0,
              polls: 0,
              skipped: 0,
              hasMore: false,
              errorCode: "SOURCE_HTTP_FAILED",
            },
            rows: [],
          }
        : original(channel, signal),
    );
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "FAILED", imported: 1, failedChannels: 1 });
    const status = await readPollSyncStatus(testDb.database.db, {});
    expect(status.lastSuccessfulImportAt).toBeNull();
    expect(status.latest?.channelReports).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: "뭉케뭉케", status: "FAILED" })]),
    );
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "RETRY_NOT_DUE" });
    client.collect.mockImplementation(original);
    client.collect.mockClear();
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date(now.getTime() + 16 * 60_000),
        provider: client,
        wait,
      }),
    ).toMatchObject({ status: "SUCCEEDED", imported: 1 });
    expect(client.collect).toHaveBeenCalledTimes(1);
  });
  it("does not let yesterday's failure block today's recent-window refresh", async () => {
    const client = provider();
    client.collect.mockRejectedValueOnce(new Error("secret transport details"));
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "FAILED", code: "SYNC_FAILED" });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-19T23:00:00Z"),
        provider: client,
        wait,
      }),
    ).toMatchObject({ status: "SUCCEEDED" });
  });
  it("rolls back the entire failing channel transaction and its checkpoint", async () => {
    const client = provider();
    client.collect.mockResolvedValueOnce({
      report: {
        channel: "진행빵집",
        status: "OK",
        pages: 1,
        posts: 2,
        polls: 2,
        skipped: 0,
        hasMore: false,
      },
      rows: [
        { source, raw: {} },
        { source: { ...source, postId: "UgkxInvalid2" }, raw: { bad: BigInt(1) } },
      ],
    });
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client, wait }),
    ).toMatchObject({ status: "FAILED" });
    expect(await testDb.database.db.select().from(operatorPollCandidates)).toHaveLength(0);
    expect((await readPollSyncStatus(testDb.database.db, {})).latest?.channelReports).toEqual([]);
  });
  it("rejects an importer without an active operator grant", async () => {
    const client = provider();
    expect(
      await runDailyPollSync(testDb.database.db, {
        env: { ...env, POLL_SYNC_IMPORT_MEMBER_ID: "00000000-0000-4000-8000-000000000001" },
        now,
        provider: client,
        wait,
      }),
    ).toMatchObject({ status: "FAILED", code: "IMPORT_OPERATOR_REQUIRED" });
    expect(client.collect).not.toHaveBeenCalled();
  });
});
