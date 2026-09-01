/* Test doubles intentionally implement asynchronous storage boundaries. */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/database/schema/index.js";
import { createTestDatabase } from "./helpers/test-database.js";
import { clearDecision, judgeConfig, providerConfig } from "./helpers/policy-judge-fixtures.js";
import {
  createAutoPublicationService,
  autoPublicationConfig,
  clearPublicationEvidence,
} from "../src/modules/issue-media/auto-publication.js";
import type { IssueMediaObjectStorage } from "../src/modules/issue-media/contracts.js";
import {
  EMBEDDED_TEXT_VERSION,
  type EmbeddedText,
} from "../src/modules/issue-media/embedded-text.js";
import { createPolicyJudgeService } from "../src/modules/policy-judge/service.js";
import { POLICY_JUDGE_PROFILE } from "../src/modules/policy-judge/contracts.js";
import { prepareJudgeRequest } from "../src/modules/policy-judge/adapter.js";
import { createModerationProviderInputResolver } from "../src/modules/moderation-providers/input-resolver.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "../src/modules/moderation-providers/contracts.js";
import {
  OPENAI_IMAGE_LABELS,
  OPENAI_TEXT_LABELS,
} from "../src/modules/moderation-providers/openai-coverage.js";
import {
  MODERATION_POLICY_VERSION,
  createModerationSubmissionEvents,
} from "../src/modules/moderation-dispatch/contracts.js";
import { createModerationDispatcherService } from "../src/modules/moderation-dispatch/service.js";
import { withModerationWorkerLock } from "../src/modules/moderation-dispatch/worker-lock.js";
import { createSubmissionWakeups } from "../src/modules/moderation-dispatch/submission-wakeups.js";
import { submissionWakeup as wakeupEvent } from "../src/modules/moderation-dispatch/submission-wakeup-event.js";

// Explicit due time: the local Docker PostgreSQL clock can lead the host clock.
const submissionWakeup = (...args: Parameters<typeof wakeupEvent>) =>
  wakeupEvent(...args).map((row) => ({ ...row, availableAt: new Date(0) }));

describe("explicit image publication pilot", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);
  afterAll(async () => {
    await testDb.database.close();
    await testDb.drop();
  });
  const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
  async function fixture() {
    const db = testDb.database.db;
    const [member] = await db
      .insert(schema.members)
      .values({ displayName: "Pilot fixture" })
      .returning();
    await db.insert(schema.memberMediaConsents).values({
      memberId: member!.id,
      consentVersion: "which-media-consent-v2",
      acceptedAt: new Date("2026-01-01"),
    });
    await db.insert(schema.memberCapabilityGrants).values({
      memberId: member!.id,
      capabilityCode: "ISSUE_IMAGE_UPLOAD",
      policyVersion: "test",
      reason: "Test explicit grant",
      expiresAt: new Date("2040-01-01"),
    });
    const objects = new Map<string, Buffer>();
    const storage: IssueMediaObjectStorage = {
      stage: vi.fn(),
      publish: vi.fn(),
      quarantine: vi.fn(),
      restorePublished: vi.fn(),
      publicUrl: (key) => `https://media.test/${key}`,
      read: async (key) => {
        if (!objects.has(key)) throw new Error("MISSING");
        return objects.get(key)!;
      },
      exists: async (key) => objects.has(key),
      preparePublication: vi.fn(async (key: string, bytes: Buffer) => {
        objects.set(key, bytes);
      }),
      purge: vi.fn(async (keys: Array<string | null | undefined>) => {
        for (const key of keys) if (key) objects.delete(key);
      }),
    };
    const assets = [];
    for (const color of ["#2376b3", "#a76a53"]) {
      const bytes = await sharp({
        create: { width: 320, height: 400, channels: 3, background: color },
      })
        .webp()
        .toBuffer();
      const key = `issue-media/staging/${randomUUID()}.webp`;
      objects.set(key, bytes);
      const [asset] = await db
        .insert(schema.issueMediaAssets)
        .values({
          uploadedByMemberId: member!.id,
          sourceType: "MEMBER_SUBMISSION",
          rightsAttestation: "Test fixture with explicit usage rights",
          rightsAttestedAt: new Date(),
          sha256: hash(randomUUID()),
          perceptualHash: hash(bytes).slice(0, 16),
          inputMimeType: "image/png",
          inputByteSize: 200,
          inputWidth: 320,
          inputHeight: 400,
          outputByteSize: bytes.length,
          outputWidth: 320,
          outputHeight: 400,
          stagingObjectKey: key,
        })
        .returning();
      await db.insert(schema.issueMediaAssetVersions).values({
        ...asset!,
        assetId: asset!.id,
        version: 1,
        normalizedObjectRef: key,
        inputHash: hash(bytes),
      });
      assets.push(asset!);
    }
    const [submission] = await db
      .insert(schema.memberIssueSubmissions)
      .values({
        memberId: member!.id,
        idempotencyKey: randomUUID(),
        question: "어떤 색이 더 마음에 드나요?",
        choiceA: "파랑",
        choiceB: "갈색",
        interestCardCode: "DAILY_LIFE",
        contentHash: hash(randomUUID()),
        mediaAssetAId: assets[0]!.id,
        mediaAssetBId: assets[1]!.id,
      })
      .returning();
    await db
      .insert(schema.memberIssueSubmissionRevisions)
      .values({ ...submission!, submissionId: submission!.id });
    const [target] = await db
      .insert(schema.moderationTargets)
      .values({
        targetType: "ISSUE_VERSION",
        targetId: submission!.id,
        targetVersion: 1,
        inputHash: submission!.contentHash,
        snapshotReference: `issue-submission://revision/${submission!.id}/1`,
      })
      .returning();
    const extract = vi.fn(async (): Promise<EmbeddedText> => ({
      version: EMBEDDED_TEXT_VERSION,
      status: "COMPLETE" as const,
      text: "",
    }));
    const resolver = createModerationProviderInputResolver({
      database: db,
      storage,
      extractEmbeddedText: extract,
    });
    const targetInput = {
      targetType: "ISSUE_VERSION" as const,
      targetId: submission!.id,
      targetVersion: 1,
      normalizedInputHash: submission!.contentHash,
      privateObjectReference: target!.snapshotReference,
      policyVersion: MODERATION_POLICY_VERSION,
    };
    const input = await resolver(targetInput);
    const safety = {
      schemaVersion: 1,
      provider: "OPENAI_MODERATION",
      modality: "TEXT_AND_IMAGE",
      inputScope: "SUBMISSION_REVISION",
      imageCount: 2,
      modelSnapshot: providerConfig().OPENAI_MODERATION_MODEL,
      supportedLabels: [],
      unsupportedLabels: [],
      signals: OPENAI_TEXT_LABELS.map((label) => ({
        providerLabel: label,
        canonicalCode: label,
        rawScore: 0.001,
        calibratedBand: "LOW",
        flagged: false,
        appliedModalities: (OPENAI_IMAGE_LABELS as readonly string[]).includes(label)
          ? ["TEXT", "IMAGE"]
          : ["TEXT"],
        regions: [],
      })),
      abstained: false,
      providerDisagreement: null,
      capabilities: { boundingBoxes: false },
      publicationChanged: false,
      embeddedText: input.embeddedText,
      inputBinding: {
        contractVersion: MODERATION_PROVIDER_INPUT_VERSION,
        targetType: "ISSUE_VERSION",
        targetVersion: 1,
        inputHash: submission!.contentHash,
      },
    };
    const [run] = await db
      .insert(schema.moderationRuns)
      .values({
        targetId: target!.id,
        policyVersion: MODERATION_POLICY_VERSION,
        stage: "PROVIDER_SHADOW",
        normalizedInputHash: submission!.contentHash,
        modelProvider: "OPENAI_MODERATION",
        ruleVersion: "test",
        status: "SUCCEEDED",
        decisionSource: "MODEL",
        result: safety,
        completedAt: new Date(),
      })
      .returning();
    const prepared = await prepareJudgeRequest(input, MODERATION_POLICY_VERSION);
    const [evaluation] = await db
      .insert(schema.policyJudgeEvaluations)
      .values({
        sourceRunId: run!.id,
        profile: POLICY_JUDGE_PROFILE,
        cacheKey: prepared.cacheKey,
        status: "SUCCEEDED",
        reason: "COVERAGE_GAP",
        completedAt: new Date(),
        result: { decision: clearDecision },
      })
      .returning();
    const config = autoPublicationConfig({
      ISSUE_MEDIA_AUTO_PUBLICATION_MODE: "PILOT",
      ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH: "false",
      ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS: member!.id,
    });
    const judge = createPolicyJudgeService({
      database: db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput: resolver,
    });
    const runtimeAllowed = vi.fn(() => true);
    const service = createAutoPublicationService({
      database: db,
      storage,
      config,
      judge,
      resolveInput: resolver,
      safetyModel: providerConfig().OPENAI_MODERATION_MODEL,
      runtimeAllowed,
    });
    return {
      db,
      member: member!,
      assets,
      submission: submission!,
      target: target!,
      run: run!,
      evaluation: evaluation!,
      input,
      safety,
      storage,
      objects,
      config,
      service,
      extract,
      runtimeAllowed,
    };
  }
  it("defaults closed and rejects an empty or malformed cohort", () => {
    expect(autoPublicationConfig({}).ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH).toBe(true);
    expect(() =>
      autoPublicationConfig({ ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS: "not-an-id" }),
    ).toThrow();
  });
  it("durably dispatches one job across concurrent dispatchers and acknowledges actual publication", async () => {
    const f = await fixture();
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    const wakeups = createSubmissionWakeups(f.db, [f.member.id]);
    const start = vi.fn(async () => {});
    await Promise.all([wakeups.dispatch(start), wakeups.dispatch(start)]);
    expect(start).toHaveBeenCalledTimes(1);
    const [request] = await wakeups.claimed();
    expect(request).toBeTruthy();
    expect(await f.service.process(f.evaluation.id)).toMatchObject({ status: "PUBLISHED" });
    await wakeups.finish(request!);
    expect(await wakeups.claimed()).toEqual([]);
    await wakeups.dispatch(start);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("converts uncertain judgement into an editable private outcome with one notification", async () => {
    const f = await fixture();
    await f.db
      .update(schema.policyJudgeEvaluations)
      .set({
        status: "ABSTAINED",
        result: {
          decision: {
            ...clearDecision,
            decision: "ABSTAIN",
            reason_codes: ["INSUFFICIENT_DETAIL"],
            needs_human: true,
          },
        },
      })
      .where(eq(schema.policyJudgeEvaluations.id, f.evaluation.id));
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    const wakeups = createSubmissionWakeups(f.db, [f.member.id]);
    await wakeups.dispatch(async () => {});
    const [request] = await wakeups.claimed();
    await wakeups.finish(request!);
    await wakeups.finish(request!);
    const [row] = await f.db
      .select()
      .from(schema.memberIssueSubmissions)
      .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    expect(row).toMatchObject({ status: "NEEDS_CHANGES", publishedIssueId: null });
    expect(row!.reviewNote).toContain("충분히 확인하지 못해");
    expect(
      await f.db
        .select()
        .from(schema.memberModerationNotices)
        .where(eq(schema.memberModerationNotices.memberId, f.member.id)),
    ).toHaveLength(1);
    expect(f.storage.preparePublication).not.toHaveBeenCalled();
  });
  it("defers an unknown job start without immediate duplicate execution and eventually exposes technical failure", async () => {
    const f = await fixture();
    // No AI result should be assumed when the Job has not run.
    await f.db
      .delete(schema.policyJudgeEvaluations)
      .where(eq(schema.policyJudgeEvaluations.id, f.evaluation.id));
    let time = new Date();
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    const wakeups = createSubmissionWakeups(f.db, [f.member.id], () => time);
    const start = vi.fn(async () => {
      throw new Error("ambiguous timeout");
    });
    expect(await wakeups.dispatch(start)).toMatchObject({ status: "START_UNKNOWN" });
    await wakeups.dispatch(start);
    expect(start).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      time = new Date(time.getTime() + 13 * 60000);
      await wakeups.dispatch(start);
    }
    expect(start).toHaveBeenCalledTimes(5);
    const [row] = await f.db
      .select()
      .from(schema.memberIssueSubmissions)
      .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    expect(row).toMatchObject({ status: "NEEDS_CHANGES", publishedIssueId: null });
    expect(row!.reviewNote).toContain("자동 검사를 완료하지 못했어요");
  });
  it("explains an incomplete private OCR scan without exposing extracted text", async () => {
    const f = await fixture();
    await f.db
      .update(schema.moderationRuns)
      .set({
        status: "DEAD_LETTERED",
        errorCode: "PROVIDER_INPUT_UNAVAILABLE",
        errorMessage: "INPUT_UNAVAILABLE:LOCAL_SCAN_PARTIAL",
        deadLetteredAt: new Date(),
      })
      .where(eq(schema.moderationRuns.id, f.run.id));
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    const wakeups = createSubmissionWakeups(f.db, [f.member.id]);
    await wakeups.dispatch(async () => {});
    const [request] = await wakeups.claimed();
    await wakeups.finish(request!);
    const [row] = await f.db
      .select()
      .from(schema.memberIssueSubmissions)
      .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    expect(row).toMatchObject({ status: "NEEDS_CHANGES", publishedIssueId: null });
    expect(row!.reviewNote).toContain("이미지 속 문자 검사를 완료하지 못했어요");
    expect(row!.reviewNote).not.toContain("LOCAL_SCAN");
  });
  it("requires a claimed new submission wakeup for the automated job scope", async () => {
    const f = await fixture();
    const judge = createPolicyJudgeService({
      database: f.db,
      config: judgeConfig(),
      provider: providerConfig(),
      resolveInput: async () => f.input,
      submissionWakeupsOnly: true,
    });
    expect(await judge.readCurrentSource(f.run.id)).toBeNull();
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    expect(await judge.readCurrentSource(f.run.id)).toBeNull();
    const wrongCohort = createSubmissionWakeups(f.db, [randomUUID()]);
    const start = vi.fn(async () => {});
    await wrongCohort.dispatch(start);
    expect(start).not.toHaveBeenCalled();
    await createSubmissionWakeups(f.db, [f.member.id]).dispatch(start);
    expect(await judge.readCurrentSource(f.run.id)).not.toBeNull();
    await f.db
      .update(schema.memberIssueSubmissions)
      .set({ revision: f.submission.revision + 1 })
      .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    expect(await judge.readCurrentSource(f.run.id)).toBeNull();
  });
  it("publishes a current clear pair once, records system evidence and a notification, then cleans private copies", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.service.process(f.evaluation.id),
      f.service.process(f.evaluation.id),
    ]);
    expect(results.filter((r) => r.status === "PUBLISHED")).toHaveLength(1);
    await f.service.reconcile();
    const [row] = await f.db
      .select()
      .from(schema.memberIssueSubmissions)
      .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    expect(row?.status).toBe("APPROVED");
    expect(row?.publishedIssueId).toBeTruthy();
    const notices = await f.db
      .select()
      .from(schema.memberModerationNotices)
      .where(eq(schema.memberModerationNotices.memberId, f.member.id));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.reasonCode).toBe("AI_PILOT_MEDIA_PUBLISHED");
    expect([...f.objects.keys()]).toHaveLength(2);
    expect(
      [...f.objects.keys()].every((key) => key.startsWith("issue-media/published/auto/")),
    ).toBe(true);
    expect(await f.service.process(f.evaluation.id)).toMatchObject({ status: "HELD" });
  });
  it.each([
    "revision",
    "cancel",
    "consent",
    "grant",
    "rights",
    "hash",
    "profile",
    "expired",
    "uncertain",
    "safety",
    "coverage",
    "model",
    "kill",
    "cohort",
    "runtime",
  ])("holds when %s changes", async (condition) => {
    const f = await fixture();
    if (condition === "revision")
      await f.db
        .update(schema.memberIssueSubmissions)
        .set({ revision: 2 })
        .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    if (condition === "cancel")
      await f.db
        .update(schema.memberIssueSubmissions)
        .set({ status: "CANCELLED" })
        .where(eq(schema.memberIssueSubmissions.id, f.submission.id));
    if (condition === "consent")
      await f.db
        .update(schema.memberMediaConsents)
        .set({ revokedAt: new Date() })
        .where(eq(schema.memberMediaConsents.memberId, f.member.id));
    if (condition === "grant")
      await f.db
        .update(schema.memberCapabilityGrants)
        .set({ grantedAt: new Date("2019-01-01"), expiresAt: new Date("2020-01-01") })
        .where(eq(schema.memberCapabilityGrants.memberId, f.member.id));
    if (condition === "rights")
      await f.db
        .update(schema.issueMediaAssets)
        .set({ rightsState: "CHALLENGED" })
        .where(eq(schema.issueMediaAssets.id, f.assets[0]!.id));
    if (condition === "hash")
      f.objects.set(f.assets[0]!.stagingObjectKey!, Buffer.from("replacement"));
    if (condition === "profile")
      await f.db
        .update(schema.policyJudgeEvaluations)
        .set({ profile: "old-profile" })
        .where(eq(schema.policyJudgeEvaluations.id, f.evaluation.id));
    if (condition === "expired")
      await f.db
        .update(schema.policyJudgeEvaluations)
        .set({ completedAt: new Date("2020-01-01") })
        .where(eq(schema.policyJudgeEvaluations.id, f.evaluation.id));
    if (condition === "uncertain")
      await f.db
        .update(schema.policyJudgeEvaluations)
        .set({ result: { decision: { ...clearDecision, privacy_risk: "UNCERTAIN" } } })
        .where(eq(schema.policyJudgeEvaluations.id, f.evaluation.id));
    if (["safety", "coverage", "model"].includes(condition)) {
      if (condition === "safety") f.safety.signals[0]!.flagged = true;
      if (condition === "coverage") f.safety.signals.pop();
      if (condition === "model") f.safety.modelSnapshot = "unapproved-model";
      await f.db
        .update(schema.moderationRuns)
        .set({ result: f.safety })
        .where(eq(schema.moderationRuns.id, f.run.id));
    }
    if (condition === "kill") f.config.ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH = true;
    if (condition === "cohort") f.config.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS = [];
    if (condition === "runtime") f.runtimeAllowed.mockReturnValue(false);
    await f.service.process(f.evaluation.id).catch(() => null);
    expect(f.storage.preparePublication).not.toHaveBeenCalled();
  });
  it("does not reuse a clear result after local OCR/QR evidence becomes incomplete", async () => {
    const f = await fixture();
    f.extract.mockResolvedValue({
      version: EMBEDDED_TEXT_VERSION,
      status: "PARTIAL",
      text: "",
    });
    await expect(f.service.process(f.evaluation.id)).rejects.toThrow();
    expect(f.storage.preparePublication).not.toHaveBeenCalled();
  });
  it("recovers a partial R2 write without losing private sources, then retries idempotently", async () => {
    const f = await fixture();
    vi.mocked(f.storage.preparePublication!)
      .mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
      })
      .mockImplementationOnce(async (key, bytes) => {
        f.objects.set(key, bytes);
        throw new Error("Lost acknowledgement");
      });
    await expect(f.service.process(f.evaluation.id)).rejects.toThrow();
    await f.service.reconcile();
    expect([...f.objects.keys()]).toEqual(f.assets.map((a) => a.stagingObjectKey));
    const rows = await f.db
      .select()
      .from(schema.issueMediaAssets)
      .where(
        inArray(
          schema.issueMediaAssets.id,
          f.assets.map((a) => a.id),
        ),
      );
    expect(rows.every((a) => a.storageState === "STAGED")).toBe(true);
    expect(await f.service.process(f.evaluation.id)).toMatchObject({ status: "PUBLISHED" });
    await f.service.reconcile();
  });
  it("keeps a capped provider run pending and does not process non-cohort tasks", async () => {
    const f = await fixture();
    await f.db.insert(schema.outboxEvents).values(
      createModerationSubmissionEvents({
        targetType: "ISSUE_VERSION",
        targetId: f.submission.id,
        targetVersion: 1,
        normalizedInputHash: f.submission.contentHash,
        privateObjectReference: f.target.snapshotReference,
        reason: "CREATE",
        occurredAt: new Date(0),
      }).rows.map((r) => ({ ...r, availableAt: new Date(0) })),
    );
    await f.db
      .update(schema.moderationRuns)
      .set({ status: "PENDING", availableAt: new Date(0) })
      .where(eq(schema.moderationRuns.id, f.run.id));
    const adapter = {
      provider: "OPENAI_MODERATION",
      modelName: "omni-moderation",
      modelVersion: "test",
      cacheTtlMilliseconds: 60_000,
      inspect: vi.fn(),
    };
    const opts = {
      batchSize: 1,
      leaseMilliseconds: 60000,
      maxAttempts: 5,
      retryBaseMilliseconds: 1000,
      retryMaxMilliseconds: 60000,
      deferProviderGate: true,
      providerGate: () => ({ allowed: false, reason: "DAILY_CALL_CAP_REACHED" }),
    };
    const scoped = createModerationDispatcherService(f.db, adapter, {
      ...opts,
      submissionMemberIds: [f.member.id],
      submissionWakeupsOnly: true,
    });
    expect(await scoped.dispatchBatch()).toMatchObject({ claimed: 0 });
    expect(await scoped.processBatch()).toMatchObject({ claimed: 0 });
    await f.db
      .insert(schema.outboxEvents)
      .values(submissionWakeup(f.submission.id, f.submission.revision, true));
    // Claim only this fixture's request to avoid leaving unrelated fixture work in the batch.
    await f.db
      .update(schema.outboxEvents)
      .set({
        claimToken: randomUUID(),
        claimedAt: new Date(),
        availableAt: new Date(Date.now() + 600000),
      })
      .where(eq(schema.outboxEvents.aggregateId, f.submission.id));
    expect(await scoped.dispatchBatch()).toMatchObject({ claimed: 1 });
    expect(await scoped.processBatch()).toMatchObject({ claimed: 1, retried: 1 });
    const [request] = await createSubmissionWakeups(f.db, [f.member.id]).claimed();
    await createSubmissionWakeups(f.db, [f.member.id]).finish(request!, { budgetDeferred: true });
    const [queued] = await f.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, request!.id));
    expect(queued).toMatchObject({
      status: "PENDING",
      lastError: "DAILY_BUDGET_DEFERRED",
      claimToken: null,
    });
    expect(queued!.availableAt.toISOString().slice(0, 10)).not.toBe(
      new Date().toISOString().slice(0, 10),
    );
    // The original cohort assertions below exercise unscoped compatibility separately.
    await f.db
      .update(schema.moderationRuns)
      .set({ status: "PENDING", availableAt: new Date(0) })
      .where(eq(schema.moderationRuns.id, f.run.id));
    await f.db
      .update(schema.outboxEvents)
      .set({ status: "PENDING", publishedAt: null, availableAt: new Date(0) })
      .where(eq(schema.outboxEvents.eventType, "MODERATION_REQUESTED"));
    expect(
      await createModerationDispatcherService(f.db, adapter, {
        ...opts,
        submissionMemberIds: [],
      }).dispatchBatch(),
    ).toMatchObject({ claimed: 0 });
    expect(
      await createModerationDispatcherService(f.db, adapter, {
        ...opts,
        submissionMemberIds: [f.member.id],
      }).dispatchBatch(),
    ).toMatchObject({ claimed: 1 });
    expect(
      await createModerationDispatcherService(f.db, adapter, {
        ...opts,
        submissionMemberIds: [randomUUID()],
      }).processBatch(),
    ).toMatchObject({ claimed: 0 });
    expect(
      await createModerationDispatcherService(f.db, adapter, {
        ...opts,
        submissionMemberIds: [f.member.id],
      }).processBatch(),
    ).toMatchObject({ claimed: 1, retried: 1 });
    const [row] = await f.db
      .select()
      .from(schema.moderationRuns)
      .where(eq(schema.moderationRuns.id, f.run.id));
    expect(row?.status).toBe("PENDING");
    expect(row?.attemptCount).toBe(0);
    expect(adapter.inspect).not.toHaveBeenCalled();
  });
  it("rejects conflicting ALLOW labels and mismatched A/B bindings", async () => {
    const f = await fixture();
    const input = {
      result: f.safety,
      decision: clearDecision,
      model: f.safety.modelSnapshot,
      revision: 1,
      hash: f.submission.contentHash,
      imageHashes: f.input.embeddedText!.images.map((i) => i.normalizedHash),
    };
    expect(clearPublicationEvidence(input)).toBe(true);
    expect(
      clearPublicationEvidence({
        ...input,
        decision: { ...clearDecision, reason_codes: ["NONE", "SEXUAL"] },
      }),
    ).toBe(false);
    expect(
      clearPublicationEvidence({ ...input, imageHashes: [...input.imageHashes].reverse() }),
    ).toBe(false);
  });
  it("serializes overlapping runtime processes and releases the lock on failure", async () => {
    const db = testDb.database.db;
    let release!: () => void;
    let entered!: () => void;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = withModerationWorkerLock(db, async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await active;
    expect(await withModerationWorkerLock(db, async () => "unexpected")).toMatchObject({
      status: "WORKER_BUSY",
    });
    release();
    await held;
    await expect(
      withModerationWorkerLock(db, async () => {
        throw new Error("test");
      }),
    ).rejects.toThrow("test");
    expect(await withModerationWorkerLock(db, async () => "released")).toBe("released");
  });
});
