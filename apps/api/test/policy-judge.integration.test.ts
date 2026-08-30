import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  issueMediaAssets,
  issueMediaKnownBlockHashes,
  memberMediaConsents,
  memberCapabilityGrants,
  memberIssueSubmissions,
  members,
  moderationProviderCallCache,
  moderationRuns,
  moderationTargets,
  policyJudgeBudgets,
  policyJudgeEvaluations,
} from "../src/database/schema/index.js";
import { MODERATION_POLICY_VERSION } from "../src/modules/moderation-dispatch/contracts.js";
import { createModerationProviderGate } from "../src/modules/moderation-providers/runtime-gate.js";
import { createJudgeLedger } from "../src/modules/policy-judge/ledger.js";
import { createPolicyJudgeService } from "../src/modules/policy-judge/service.js";
import {
  POLICY_JUDGE_MODEL,
  POLICY_JUDGE_PROFILE,
  POLICY_JUDGE_PROVIDER,
} from "../src/modules/policy-judge/contracts.js";
import { createTestDatabase } from "./helpers/test-database.js";
import {
  clearDecision,
  judgeConfig,
  pairInput,
  providerConfig,
} from "./helpers/policy-judge-fixtures.js";

describe("Luna durable budget and Shadow pipeline", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    testDb = await createTestDatabase();
  });
  afterAll(async () => {
    await testDb.database.close();
    await testDb.drop();
  });
  const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
  async function source() {
    const db = testDb.database.db;
    const [member] = await db.insert(members).values({ displayName: "Judge test" }).returning();
    await db
      .insert(memberMediaConsents)
      .values({ memberId: member!.id, consentVersion: "which-media-consent-v1" });
    await db.insert(memberCapabilityGrants).values({
      memberId: member!.id,
      capabilityCode: "ISSUE_IMAGE_UPLOAD",
      policyVersion: "test",
      reason: "Fixture upload access",
      expiresAt: new Date("2040-01-01T00:00:00Z"),
    });
    const assets = [];
    for (let i = 0; i < 2; i++) {
      const [asset] = await db
        .insert(issueMediaAssets)
        .values({
          uploadedByMemberId: member!.id,
          sourceType: "MEMBER_SUBMISSION",
          rightsAttestation: "Test fixture owned by test runner",
          rightsAttestedAt: new Date(),
          sha256: hash(),
          perceptualHash: hash().slice(0, 16),
          inputMimeType: "image/png",
          inputByteSize: 100,
          inputWidth: 1024,
          inputHeight: 768,
          outputByteSize: 80,
          outputWidth: 1024,
          outputHeight: 768,
          stagingObjectKey: `test/${randomUUID()}.webp`,
          processingState: "READY",
          storageState: "STAGED",
          moderationState: "PENDING",
          rightsState: "ASSERTED",
        })
        .returning();
      assets.push(asset!);
    }
    const contentHash = hash();
    const [submission] = await db
      .insert(memberIssueSubmissions)
      .values({
        memberId: member!.id,
        idempotencyKey: randomUUID(),
        question: "어떤 색이 좋나요?",
        choiceA: "파랑",
        choiceB: "초록",
        interestCardCode: "LIFE",
        contentHash,
        mediaAssetAId: assets[0]!.id,
        mediaAssetBId: assets[1]!.id,
      })
      .returning();
    const [target] = await db
      .insert(moderationTargets)
      .values({
        targetType: "ISSUE_VERSION",
        targetId: submission!.id,
        targetVersion: 1,
        inputHash: contentHash,
        snapshotReference: `issue-submission://revision/${submission!.id}/1`,
      })
      .returning();
    const input = await pairInput();
    const [run] = await db
      .insert(moderationRuns)
      .values({
        targetId: target!.id,
        policyVersion: MODERATION_POLICY_VERSION,
        stage: "PROVIDER_SHADOW",
        normalizedInputHash: contentHash,
        modelProvider: "OPENAI_MODERATION",
        modelName: "omni-moderation",
        modelVersion: "omni-moderation-2024-09-26",
        ruleVersion: "test",
        status: "SUCCEEDED",
        decisionSource: "MODEL",
        completedAt: new Date(),
        result: {
          provider: "OPENAI_MODERATION",
          inputScope: "SUBMISSION_REVISION",
          imageCount: 2,
          abstained: false,
          modelSnapshot: "omni-moderation-2024-09-26",
          embeddedText: input.embeddedText,
          signals: [{ flagged: false, rawScore: 0.01 }],
        },
      })
      .returning();
    return { run: run!, submission: submission!, assets, input };
  }
  function reserveInput(sourceRunId: string, cacheKey = hash(), reservedMicros = 1000) {
    return {
      sourceRunId,
      cacheKey,
      reservedMicros,
      policyVersion: MODERATION_POLICY_VERSION,
      reason: "COVERAGE_GAP",
      isCurrent: () => Promise.resolve(true),
    };
  }

  it("atomically bounds concurrent reservations by both calls and spend", async () => {
    const now = () => new Date("2030-01-01T12:00:00Z");
    const ledger = createJudgeLedger(
      testDb.database.db,
      {
        ...judgeConfig(),
        MODERATION_POLICY_JUDGE_DAILY_CALL_CAP: 3,
        MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP: 2500,
      },
      now,
    );
    const sources = await Promise.all(Array.from({ length: 6 }, () => source()));
    const reservations = await Promise.all(
      sources.map((s) => ledger.reserve(reserveInput(s.run.id))),
    );
    expect(reservations.filter((r) => r.status === "RESERVED")).toHaveLength(2);
    const [budget] = await testDb.database.db
      .select()
      .from(policyJudgeBudgets)
      .where(eq(policyJudgeBudgets.day, "2030-01-01"));
    expect(budget).toMatchObject({ calls: 2, committedMicros: 2000 });
  });
  it("deduplicates simultaneous requests for identical pair context", async () => {
    const ledger = createJudgeLedger(
      testDb.database.db,
      judgeConfig(),
      () => new Date("2030-01-02T12:00:00Z"),
    );
    const sources = await Promise.all([source(), source()]);
    const cacheKey = hash();
    const results = await Promise.all(
      sources.map((s) => ledger.reserve(reserveInput(s.run.id, cacheKey))),
    );
    expect(results.map((r) => r.status).sort()).toEqual(["DEFERRED", "RESERVED"]);
  });
  it("settles once on reservation day, reuses valid cache without spending, and rejects stale cache targets", async () => {
    let time = new Date("2030-01-03T23:59:59Z");
    const db = testDb.database.db;
    const ledger = createJudgeLedger(db, judgeConfig(), () => time);
    const first = await source();
    const cacheKey = hash();
    const reserved = await ledger.reserve(reserveInput(first.run.id, cacheKey));
    if (reserved.status !== "RESERVED") throw new Error("fixture reservation failed");
    time = new Date("2030-01-04T00:00:01Z");
    const finish = {
      id: reserved.job.id,
      status: "SUCCEEDED" as const,
      reason: "COMPLETED",
      result: { decision: clearDecision },
      chargedMicros: 100,
      costMicros: 80,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 12,
      policyVersion: MODERATION_POLICY_VERSION,
      isCurrent: () => Promise.resolve(true),
    };
    expect(await ledger.finish(finish)).toBe("SUCCEEDED");
    expect(await ledger.finish(finish)).toBe("ALREADY_FINISHED");
    const [budget] = await db
      .select()
      .from(policyJudgeBudgets)
      .where(eq(policyJudgeBudgets.day, "2030-01-03"));
    expect(budget).toMatchObject({ calls: 1, committedMicros: 100 });
    const second = await source();
    expect((await ledger.reserve(reserveInput(second.run.id, cacheKey))).status).toBe("CACHE_HIT");
    const third = await source();
    expect(
      (
        await ledger.reserve({
          ...reserveInput(third.run.id, cacheKey),
          isCurrent: () => Promise.resolve(false),
        })
      ).status,
    ).toBe("STALE");
    time = new Date("2030-01-05T00:00:02Z");
    expect((await ledger.reserve(reserveInput(third.run.id, cacheKey))).status).toBe("RESERVED");
  });
  it("does not refund unknown requests, or automatically repeat them after a worker crash", async () => {
    let time = new Date("2030-01-06T12:00:00Z");
    const ledger = createJudgeLedger(testDb.database.db, judgeConfig(), () => time);
    const s = await source();
    const input = reserveInput(s.run.id);
    const r = await ledger.reserve(input);
    if (r.status !== "RESERVED") throw new Error("fixture");
    time = new Date("2030-01-06T12:06:00Z");
    await ledger.reconcileUnknown();
    const [row] = await testDb.database.db
      .select()
      .from(policyJudgeEvaluations)
      .where(eq(policyJudgeEvaluations.id, r.job.id));
    expect(row).toMatchObject({ status: "UNKNOWN", chargedMicros: 1000, costMicros: null });
    expect((await ledger.reserve(input)).status).toBe("EXISTING");
  });
  it("runs one Luna call for a pair and never changes publication, notices or safety evidence", async () => {
    const s = await source();
    s.input.text = randomUUID(); // unique cache entry for this test
    const call = vi.fn().mockResolvedValue({
      decision: clearDecision,
      usage: {
        input_tokens: 1200,
        output_tokens: 150,
        input_tokens_details: { cached_tokens: 200 },
      },
      reason: "COMPLETED",
      latencyMs: 12,
    });
    const resolveInput = vi.fn().mockResolvedValue(s.input);
    const service = createPolicyJudgeService({
      database: testDb.database.db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput,
      call,
    });
    expect((await service.process(s.run.id)).status).toBe("SUCCEEDED");
    expect((await service.process(s.run.id)).status).toBe("EXISTING");
    expect(call).toHaveBeenCalledTimes(1);
    const [submission] = await testDb.database.db
      .select()
      .from(memberIssueSubmissions)
      .where(eq(memberIssueSubmissions.id, s.submission.id));
    expect(submission).toMatchObject({ status: "PENDING", publishedIssueId: null });
    const [run] = await testDb.database.db
      .select()
      .from(moderationRuns)
      .where(eq(moderationRuns.id, s.run.id));
    expect(run!.result).toEqual(s.run.result);
    expect(run!.costMicros).toBe(0);
    const [evaluation] = await testDb.database.db
      .select()
      .from(policyJudgeEvaluations)
      .where(eq(policyJudgeEvaluations.sourceRunId, s.run.id));
    expect(evaluation).toMatchObject({
      status: "SUCCEEDED",
      costMicros: 384,
      chargedMicros: 480,
      result: { publicationChanged: false },
    });
    expect(JSON.stringify(evaluation)).not.toContain(s.input.text);
  });
  it("discards stale responses while accounting for their cost", async () => {
    const s = await source();
    s.input.text = randomUUID();
    const service = createPolicyJudgeService({
      database: testDb.database.db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput: () => Promise.resolve(s.input),
      call: async () => {
        await testDb.database.db
          .update(memberIssueSubmissions)
          .set({ status: "CANCELLED" })
          .where(eq(memberIssueSubmissions.id, s.submission.id));
        return {
          decision: clearDecision,
          usage: {
            input_tokens: 100,
            output_tokens: 100,
            input_tokens_details: { cached_tokens: 0 },
          },
          reason: "COMPLETED",
          latencyMs: 10,
        };
      },
    });
    expect((await service.process(s.run.id)).status).toBe("STALE");
    const [evaluation] = await testDb.database.db
      .select()
      .from(policyJudgeEvaluations)
      .where(eq(policyJudgeEvaluations.sourceRunId, s.run.id));
    expect(evaluation!.chargedMicros).toBeGreaterThan(0);
    expect(evaluation!.result).not.toHaveProperty("decision");
    const cached = await testDb.database.db
      .select()
      .from(moderationProviderCallCache)
      .where(eq(moderationProviderCallCache.normalizedInputHash, evaluation!.cacheKey!));
    expect(cached).toHaveLength(0);
  });
  it("will not call for disabled config, failed local evidence or flagged safety", async () => {
    const s = await source();
    const call = vi.fn();
    const resolveInput = vi.fn().mockResolvedValue(s.input);
    const disabled = createPolicyJudgeService({
      database: testDb.database.db,
      config: { ...judgeConfig(), MODERATION_POLICY_JUDGE_MODE: "OFF" },
      provider: providerConfig(),
      resolveInput,
      call,
    });
    expect((await disabled.runBatch()).processed).toHaveLength(0);
    expect((await disabled.process(s.run.id)).status).toBe("DISABLED");
    await testDb.database.db
      .update(moderationRuns)
      .set({ result: { ...s.run.result, signals: [{ flagged: true, rawScore: 0.99 }] } })
      .where(eq(moderationRuns.id, s.run.id));
    const service = createPolicyJudgeService({
      database: testDb.database.db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput,
      call,
    });
    expect((await service.process(s.run.id)).reason).toBe("SAFETY_REVIEW_REQUIRED");
    expect(resolveInput).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
  it("keeps Luna cache costs outside the free Moderation runtime budget", async () => {
    await testDb.database.db.insert(moderationProviderCallCache).values({
      provider: POLICY_JUDGE_PROVIDER,
      modelName: POLICY_JUDGE_MODEL,
      modelVersion: POLICY_JUDGE_PROFILE,
      policyVersion: MODERATION_POLICY_VERSION,
      normalizedInputHash: hash(),
      status: "SUCCEEDED",
      result: { decision: clearDecision },
      costMicros: 99999,
      latencyMs: 10,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const gate = createModerationProviderGate({
      database: testDb.database.db,
      config: providerConfig(),
    });
    expect(
      (
        await gate({
          targetType: "ISSUE_VERSION",
          targetId: randomUUID(),
          targetVersion: 1,
          normalizedInputHash: hash(),
          policyVersion: MODERATION_POLICY_VERSION,
        })
      ).allowed,
    ).toBe(true);
  });

  it.each(["consent", "member", "capability", "blocked-image"])(
    "checks current %s before sending private images",
    async (kind) => {
      const s = await source();
      const db = testDb.database.db;
      if (kind === "consent")
        await db
          .update(memberMediaConsents)
          .set({ revokedAt: new Date() })
          .where(eq(memberMediaConsents.memberId, s.submission.memberId));
      if (kind === "member")
        await db
          .update(members)
          .set({ status: "SUSPENDED" })
          .where(eq(members.id, s.submission.memberId));
      if (kind === "capability")
        await db
          .update(memberCapabilityGrants)
          .set({ state: "REVOKED" })
          .where(eq(memberCapabilityGrants.memberId, s.submission.memberId));
      if (kind === "blocked-image")
        await db.insert(issueMediaKnownBlockHashes).values({
          sha256: s.assets[0]!.sha256,
          policyVersion: "test",
          reasonCode: "FIXTURE_BLOCK",
        });
      const resolveInput = vi.fn();
      const call = vi.fn();
      const service = createPolicyJudgeService({
        database: db,
        config: judgeConfig(),
        provider: providerConfig(),
        resolveInput,
        call,
      });
      expect((await service.process(s.run.id)).reason).toBe("TARGET_UNAVAILABLE");
      expect(resolveInput).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    },
  );

  it("opens the paid circuit immediately on authentication failures", async () => {
    const first = await source();
    first.input.text = randomUUID();
    const now = () => new Date("2031-01-01T12:00:00Z");
    const call = vi
      .fn()
      .mockResolvedValue({ decision: null, usage: null, reason: "AUTHENTICATION", latencyMs: 5 });
    const service = createPolicyJudgeService({
      database: testDb.database.db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput: () => Promise.resolve(first.input),
      call,
      now,
    });
    expect((await service.process(first.run.id)).status).toBe("UNKNOWN");
    const second = await source();
    expect((await service.process(second.run.id)).reason).toBe("PROVIDER_CIRCUIT_OPEN");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
