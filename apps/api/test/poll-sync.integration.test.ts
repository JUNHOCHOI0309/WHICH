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
import {
  PollSyncError,
  type OctoparsePollClient,
} from "../src/modules/operations/octoparse-polls.js";

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
    start: vi.fn<OctoparsePollClient["start"]>().mockResolvedValue(undefined),
    read: vi.fn<OctoparsePollClient["read"]>().mockResolvedValue({
      status: "READY" as const,
      rows: [{ source, raw: { original: true } }],
    }),
  };
}
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
    OCTOPARSE_MAPPING_VERIFIED: "true",
    OCTOPARSE_TASK_ID: "task-test",
    OCTOPARSE_API_KEY: "not-real",
    OCTOPARSE_IMPORT_MEMBER_ID: member!.id,
    OCTOPARSE_EXPORT_HOSTS: "export.example.com",
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
describe("daily import persistence", () => {
  it("adds only new posts once per day and never changes a dismissed candidate", async () => {
    const client = provider();
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ).toMatchObject({ status: "SUCCEEDED", imported: 1 });
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ).toMatchObject({ status: "ALREADY_COMPLETED" });
    await testDb.database.db.update(operatorPollCandidates).set({ status: "DISMISSED" });
    client.read.mockResolvedValue({
      status: "READY",
      rows: [{ source: { ...source, originalQuestion: "바뀐 원문" }, raw: {} }],
    });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-19T23:00:00Z"),
        provider: client,
      }),
    ).toMatchObject({ imported: 0, duplicates: 1 });
    const [stored] = await testDb.database.db.select().from(operatorPollCandidates);
    expect(stored).toMatchObject({
      status: "DISMISSED",
      source: { originalQuestion: source.originalQuestion },
    });
    expect(client.start).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider while unconfigured or before the scheduled hour", async () => {
    const client = provider();
    expect(await runDailyPollSync(testDb.database.db, { env: {}, provider: client })).toEqual({
      status: "NOT_CONFIGURED",
    });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-18T22:59:59Z"),
        provider: client,
      }),
    ).toEqual({ status: "NOT_DUE" });
    expect(client.start).not.toHaveBeenCalled();
  });
  it("serializes simultaneous job invocations", async () => {
    const client = provider();
    const result = await Promise.all([
      runDailyPollSync(testDb.database.db, { env, now, provider: client }),
      runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ]);
    expect(result.filter((item) => item.status === "SUCCEEDED")).toHaveLength(1);
    expect(client.start).toHaveBeenCalledTimes(1);
  });
  it("resumes a failed export without starting or paying for another extraction", async () => {
    const client = provider();
    client.read.mockRejectedValueOnce(new PollSyncError("SOURCE_FAILED"));
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ).toMatchObject({ status: "FAILED", code: "SOURCE_FAILED" });
    expect((await readPollSyncStatus(testDb.database.db, {})).lastSuccessfulImportAt).toBeNull();
    await testDb.database.db.update(operatorPollSyncRuns).set({ nextRetryAt: new Date(0) });
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ).toMatchObject({ status: "SUCCEEDED", imported: 1 });
    expect(client.start).toHaveBeenCalledTimes(1);
  });
  it("never repeats an uncertain start, even on another day", async () => {
    const client = provider();
    client.start.mockRejectedValueOnce(new Error("secret transport details"));
    expect(await runDailyPollSync(testDb.database.db, { env, now, provider: client })).toEqual({
      status: "FAILED",
      code: "SYNC_FAILED",
    });
    expect(
      await runDailyPollSync(testDb.database.db, {
        env,
        now: new Date("2026-09-19T23:00:00Z"),
        provider: client,
      }),
    ).toEqual({ status: "START_UNCERTAIN_REVIEW_REQUIRED" });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(await testDb.database.db.select().from(operatorPollCandidates)).toHaveLength(0);
  });
  it("rolls back a partially inserted batch and does not advance the success marker", async () => {
    const client = provider();
    client.read.mockResolvedValue({
      status: "READY",
      rows: [
        { source, raw: { original: true } },
        {
          source: { ...source, postId: "UgkxInvalid2" },
          raw: { original: BigInt(1) },
        },
      ],
    });
    expect(
      await runDailyPollSync(testDb.database.db, { env, now, provider: client }),
    ).toMatchObject({ status: "FAILED" });
    expect(await testDb.database.db.select().from(operatorPollCandidates)).toHaveLength(0);
    expect((await readPollSyncStatus(testDb.database.db, {})).lastSuccessfulImportAt).toBeNull();
  });
});
