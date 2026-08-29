import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  issueVersionSnapshots,
  issues,
  issueVersions,
  moderationProviderCallCache,
  moderationRuns,
  outboxEvents,
} from "../src/database/schema/index.js";
import {
  createModerationSubmissionEvents,
  moderationRequestedEventSchema,
  type ModerationShadowAdapter,
} from "../src/modules/moderation-dispatch/contracts.js";
import { createModerationDispatcherService } from "../src/modules/moderation-dispatch/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const options = {
  batchSize: 25,
  leaseMilliseconds: 30_000,
  maxAttempts: 2,
  retryBaseMilliseconds: 1_000,
  retryMaxMilliseconds: 10_000,
};

describe("Moderation Outbox Dispatcher and Shadow Worker", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function insertIssueTarget(inputHash = "a".repeat(64)) {
    const issueId = randomUUID();
    await testDatabase.database.db.insert(issues).values({ id: issueId });
    await testDatabase.database.db.insert(issueVersions).values({
      issueId,
      version: 1,
      question: "Shadow moderation 대상 질문",
      contentHash: "b".repeat(64),
      primaryCategoryCode: "LIFE",
      experienceModeCode: "PLAYFUL_QUICK",
      taxonomyVersion: "interest_cards_v1",
      publishedAt: new Date(),
    });
    await testDatabase.database.db.insert(issueVersionSnapshots).values({
      issueId,
      issueVersion: 1,
      question: "Shadow moderation 대상 질문",
      choicesSnapshot: [],
      mediaSnapshot: [],
      sourceContentHash: "b".repeat(64),
      inputHash,
      policyVersion: "issue-snapshot-v1",
    });
    const events = createModerationSubmissionEvents({
      targetType: "ISSUE_VERSION",
      targetId: issueId,
      targetVersion: 1,
      privateObjectReference: `issue://version/${issueId}/1`,
      normalizedInputHash: inputHash,
      reason: "CREATE",
    });
    await testDatabase.database.db.insert(outboxEvents).values(events.rows);
    return { issueId, events };
  }

  it("defines private, versioned events without binary data or public URLs", () => {
    const targetId = randomUUID();
    const events = createModerationSubmissionEvents({
      targetType: "ISSUE_MEDIA_ASSET",
      targetId,
      targetVersion: 1,
      privateObjectReference: `issue-media://asset/${targetId}/version/1`,
      normalizedInputHash: "c".repeat(64),
      reason: "CREATE",
    });
    expect(events.sourceEvent.eventType).toBe("ISSUE_MEDIA_ASSET_SUBMITTED");
    expect(moderationRequestedEventSchema.parse(events.requestEvent.payload).data).toMatchObject({
      target_id: targetId,
      target_version: 1,
      mode: "SHADOW",
    });
    const serialized = JSON.stringify(events.rows);
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("base64");
  });

  it("dispatches idempotently and records provider-disabled Shadow evidence only", async () => {
    const { issueId, events } = await insertIssueTarget();
    const worker = createModerationDispatcherService(testDatabase.database.db, null, options);

    expect(await worker.dispatchBatch()).toMatchObject({ queued: 1, deadLettered: 0 });
    expect(await worker.dispatchBatch()).toMatchObject({ claimed: 0 });
    expect(await worker.processBatch()).toMatchObject({ skipped: 1, deadLettered: 0 });

    const [request] = await testDatabase.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, events.requestEvent.id));
    expect(request?.status).toBe("PUBLISHED");

    const [run] = await testDatabase.database.db
      .select()
      .from(moderationRuns)
      .where(eq(moderationRuns.sourceEventId, events.requestEvent.id));
    expect(run).toMatchObject({
      status: "SKIPPED",
      mode: "SHADOW",
      costMicros: 0,
      result: {
        reason: "PROVIDER_DISABLED",
        publicationChanged: false,
      },
    });
    const [issue] = await testDatabase.database.db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(issue?.visibility).toBe("VISIBLE");
    expect(issue?.participation).toBe("VOTING_OPEN");
  });

  it("reuses a compatible provider result for the same normalized input hash", async () => {
    const sharedHash = "d".repeat(64);
    await insertIssueTarget(sharedHash);
    await insertIssueTarget(sharedHash);
    const inspect = vi.fn(() =>
      Promise.resolve({
        status: "SUCCEEDED" as const,
        result: { signals: [{ code: "SAFE_TEST_SIGNAL", confidence: 0.99 }] },
        latencyMs: 17,
        costMicros: 23,
      }),
    );
    const adapter: ModerationShadowAdapter = {
      provider: "TEST_PROVIDER",
      modelName: "shadow-moderator",
      modelVersion: "v1",
      cacheTtlMilliseconds: 60_000,
      inspect,
    };
    const worker = createModerationDispatcherService(testDatabase.database.db, adapter, {
      ...options,
      providerGate: () => ({ allowed: true, reason: "TEST_GATE" }),
    });
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ succeeded: 2 });
    expect(inspect).toHaveBeenCalledTimes(1);

    const cache = await testDatabase.database.db
      .select()
      .from(moderationProviderCallCache)
      .where(eq(moderationProviderCallCache.normalizedInputHash, sharedHash));
    expect(cache).toHaveLength(1);
    expect(cache[0]).toMatchObject({ costMicros: 23, latencyMs: 17 });
  });

  it("moves repeatedly failing executions to the Moderation dead letter queue", async () => {
    await insertIssueTarget("e".repeat(64));
    const adapter: ModerationShadowAdapter = {
      provider: "TEST_PROVIDER_FAILURE",
      modelName: "shadow-moderator",
      modelVersion: "v1",
      cacheTtlMilliseconds: 60_000,
      inspect: () => Promise.reject(new Error("provider unavailable")),
    };
    const worker = createModerationDispatcherService(testDatabase.database.db, adapter, {
      ...options,
      maxAttempts: 1,
      providerGate: () => ({ allowed: true, reason: "TEST_GATE" }),
    });
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ deadLettered: 1 });
    expect(await worker.listDeadLetters()).toHaveLength(1);
  });
});
