import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueMediaAssets,
  issueMediaAssetVersions,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  moderationProviderCallCache,
  moderationRuns,
  moderationTargets,
  moderationAuditEvents,
  memberCapabilityGrants,
  memberMediaConsents,
  members,
} from "../src/database/schema/index.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import type { IssueMediaObjectStorage } from "../src/modules/issue-media/contracts.js";
import { createIssueMediaService } from "../src/modules/issue-media/service.js";
import {
  EMBEDDED_TEXT_VERSION,
  type EmbeddedText,
} from "../src/modules/issue-media/embedded-text.js";
import { readLatestPublicationReadiness } from "../src/modules/issue-media/publication-readiness-reader.js";
import { TRUSTED_IMAGE_UPLOADER_POLICY_VERSION } from "../src/modules/issue-media/trusted-uploader-policy.js";
import { moderationDecisionRuntime } from "../src/modules/moderation/decision-runtime.js";
import { createIssueWriteService } from "../src/modules/issues/creation-service.js";
import {
  createModerationDispatcherService,
  type ModerationProviderGate,
} from "../src/modules/moderation-dispatch/service.js";
import { MODERATION_POLICY_VERSION } from "../src/modules/moderation-dispatch/contracts.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "../src/modules/moderation-providers/contracts.js";
import { moderationProviderCacheHash } from "../src/modules/moderation-providers/input-binding.js";
import { createModerationProviderInputResolver } from "../src/modules/moderation-providers/input-resolver.js";
import { createOpenAiModerationAdapter } from "../src/modules/moderation-providers/openai-moderation-adapter.js";
import {
  createModerationProviderGate,
  moderationProviderRuntimeConfig,
} from "../src/modules/moderation-providers/runtime-gate.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("immutable submission image moderation inputs", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });
  afterEach(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function fixture(extractEmbeddedText?: (bytes: Buffer) => Promise<EmbeddedText>) {
    const db = testDatabase.database.db;
    const objects = new Map<string, Buffer>();
    const unused = vi.fn(() =>
      Promise.reject(new Error("Publication is not allowed in Shadow tests")),
    );
    const storage: IssueMediaObjectStorage = {
      stage(id, bytes) {
        const objectKey = `issue-media/staging/${id}.webp`;
        objects.set(objectKey, bytes);
        return Promise.resolve({ objectKey });
      },
      read(key) {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("Missing object");
        return Promise.resolve(bytes);
      },
      publish: unused,
      quarantine: unused,
      restorePublished: unused,
      purge(keys) {
        for (const key of keys) if (key) objects.delete(key);
        return Promise.resolve();
      },
      publicUrl: (key) => `https://media.example.test/${key}`,
    };
    const identity = createMemberIdentityService(db, {
      allowDevelopmentProvider: true,
      sessionTtlSeconds: 3600,
    });
    const session = await identity.createSession({
      provider: "DEVELOPMENT",
      providerSubject: randomUUID(),
      displayName: "검사 입력 테스트",
    });
    const media = createIssueMediaService(db, storage);
    const assets = [];
    for (const background of ["#00ccdd", "#ff6633"]) {
      assets.push(
        await media.stageMemberAsset({
          memberId: session.member.id,
          rightsAttestation: "The test image was generated locally and contains no personal data.",
          declaredMimeType: "image/png",
          bytes: await sharp({ create: { width: 300, height: 200, channels: 3, background } })
            .png()
            .toBuffer(),
        }),
      );
    }
    const writer = createIssueWriteService(db);
    const command = {
      sessionToken: session.token,
      idempotencyKey: randomUUID(),
      question: "휴일에 어떤 활동을 할까요?",
      context: "가벼운 휴일의 선택입니다.",
      choiceA: "산책",
      choiceB: "독서",
      interestCardCode: "DAILY_LIFE" as const,
      mediaAssetAId: assets[0]!.id,
      mediaAssetBId: assets[1]!.id,
    };
    const { submission } = await writer.submitMemberIssue(command);
    const resolveInput = createModerationProviderInputResolver({
      database: db,
      storage,
      extractEmbeddedText,
    });
    async function target(revision = 1) {
      const [row] = await db
        .select()
        .from(memberIssueSubmissionRevisions)
        .where(
          and(
            eq(memberIssueSubmissionRevisions.submissionId, submission.id),
            eq(memberIssueSubmissionRevisions.revision, revision),
          ),
        );
      return {
        targetType: "ISSUE_VERSION" as const,
        targetId: submission.id,
        targetVersion: revision,
        privateObjectReference: `issue-submission://revision/${submission.id}/${revision}`,
        normalizedInputHash: row!.contentHash,
        policyVersion: MODERATION_POLICY_VERSION,
      };
    }
    async function runs() {
      return db
        .select({ run: moderationRuns })
        .from(moderationRuns)
        .innerJoin(moderationTargets, eq(moderationTargets.id, moderationRuns.targetId))
        .where(eq(moderationTargets.targetId, submission.id));
    }
    function worker(fetchImpl: typeof fetch, gate?: ModerationProviderGate) {
      const adapter = createOpenAiModerationAdapter({
        apiKey: "mock-only-key",
        resolveInput,
        fetchImpl,
        embeddedTextEnabled: Boolean(extractEmbeddedText),
        cacheProfile: extractEmbeddedText ? "test-embedded:LOCAL" : undefined,
      });
      return createModerationDispatcherService(db, adapter, {
        batchSize: 25,
        leaseMilliseconds: 30000,
        maxAttempts: 1,
        retryBaseMilliseconds: 1000,
        retryMaxMilliseconds: 10000,
        providerGate:
          gate ??
          ((input) => ({
            allowed: input.targetType === "ISSUE_VERSION",
            reason: "MOCK_SUBMISSION_ONLY",
          })),
      });
    }
    return {
      db,
      objects,
      storage,
      unused,
      session,
      writer,
      command,
      submission,
      resolveInput,
      target,
      runs,
      worker,
      assets,
    };
  }

  function response() {
    return new Response(
      JSON.stringify({
        model: "omni-moderation-2024-09-26",
        results: [
          {
            flagged: false,
            categories: { sexual: false },
            category_scores: { sexual: 0.001 },
            category_applied_input_types: { sexual: ["text", "image"] },
          },
        ],
      }),
      { status: 200 },
    );
  }

  it("reads current capability, consent and member status without changing stored observations or publishing", async () => {
    const f = await fixture();
    const acceptedAt = new Date(Date.now() - 10000);
    const expiresAt = new Date(Date.now() + 60000);
    await f.db.insert(memberCapabilityGrants).values({
      memberId: f.session.member.id,
      capabilityCode: "ISSUE_IMAGE_UPLOAD",
      state: "ACTIVE",
      policyVersion: TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
      reason: "Locally generated test account only",
      grantedAt: acceptedAt,
      expiresAt,
    });
    await f.db.insert(memberMediaConsents).values({
      memberId: f.session.member.id,
      consentVersion: "which-media-consent-v2",
      acceptedAt,
    });
    const fetchImpl = vi.fn(() => Promise.resolve(response()));
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    await worker.processBatch();
    const stored = (await f.runs())[0]!.run.result;
    const check = (name: string, status: string, reasons?: string[]) => ({
      readiness: {
        decisionAssessment: {
          executionAuthorized: false,
          checks: expect.arrayContaining([
            expect.objectContaining({
              check: name,
              status,
              ...(reasons ? { reasons: expect.arrayContaining(reasons) as unknown } : {}),
            }),
          ]) as unknown,
        },
      },
    });
    const first = await readLatestPublicationReadiness(f.db, f.submission.id);
    expect(first).toMatchObject(check("TECHNICAL", "PASS"));
    expect(first).toMatchObject(check("CAPABILITY", "PASS"));
    expect(first).toMatchObject(check("CONSENT", "PASS"));
    expect(first).toMatchObject(check("LOCAL_VISUAL", "UNAVAILABLE"));
    const future = await readLatestPublicationReadiness(f.db, f.submission.id, expiresAt);
    expect(future).toMatchObject(
      check("CAPABILITY", "REVIEW", ["CAPABILITY_TIME_INVALID_OR_EXPIRED"]),
    );
    // Diagnosis must not expire or rewrite the grant itself.
    expect((await f.db.select().from(memberCapabilityGrants))[0]?.state).toBe("ACTIVE");
    await f.db
      .update(memberCapabilityGrants)
      .set({ state: "REVOKED" })
      .where(eq(memberCapabilityGrants.memberId, f.session.member.id));
    expect(await readLatestPublicationReadiness(f.db, f.submission.id)).toMatchObject(
      check("CAPABILITY", "REVIEW", ["CAPABILITY_REQUIRED"]),
    );
    await f.db
      .update(memberMediaConsents)
      .set({ revokedAt: new Date() })
      .where(eq(memberMediaConsents.memberId, f.session.member.id));
    expect(await readLatestPublicationReadiness(f.db, f.submission.id)).toMatchObject(
      check("CONSENT", "REVIEW", ["CURRENT_CONSENT_REQUIRED"]),
    );
    expect(
      await readLatestPublicationReadiness(f.db, f.submission.id, new Date(), {
        consentVersion: "next-terms",
        decisionRuntime: moderationDecisionRuntime({}),
      }),
    ).toMatchObject(check("CONSENT", "REVIEW", ["CURRENT_CONSENT_REQUIRED"]));
    await f.db
      .update(members)
      .set({ status: "SUSPENDED" })
      .where(eq(members.id, f.session.member.id));
    expect(await readLatestPublicationReadiness(f.db, f.submission.id)).toMatchObject(
      check("TECHNICAL", "REVIEW", ["MEMBER_NOT_ACTIVE"]),
    );
    expect((await f.runs())[0]!.run.result).toEqual(stored);
    const caches = await f.db.select().from(moderationProviderCallCache);
    expect(JSON.stringify(caches)).not.toContain("decisionAssessment");
    expect(JSON.stringify(stored)).not.toContain(f.command.question);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("observes consent revoked during a provider request at completion, not upload-time consent", async () => {
    const f = await fixture();
    await f.db.insert(memberMediaConsents).values({
      memberId: f.session.member.id,
      consentVersion: "which-media-consent-v2",
      acceptedAt: new Date(Date.now() - 1000),
    });
    const worker = f.worker(
      vi.fn(async () => {
        await f.db
          .update(memberMediaConsents)
          .set({ revokedAt: new Date() })
          .where(eq(memberMediaConsents.memberId, f.session.member.id));
        return response();
      }),
    );
    await worker.dispatchBatch();
    await worker.processBatch();
    expect((await f.runs())[0]!.run.result).toMatchObject({
      publicationReadiness: {
        decisionAssessment: {
          executionAuthorized: false,
          checks: expect.arrayContaining([
            expect.objectContaining({
              check: "CONSENT",
              status: "REVIEW",
              reasons: ["CURRENT_CONSENT_REQUIRED"],
            }),
          ]) as unknown,
        },
      },
    });
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("extracts ordered A/B OCR once and repeats minimized context per image, persisting only metadata", async () => {
    let calls = 0;
    const extract = vi.fn((): Promise<EmbeddedText> =>
      Promise.resolve({
        version: EMBEDDED_TEXT_VERSION,
        status: "COMPLETE" as const,
        text: ++calls === 1 ? "first embedded phrase" : "second embedded phrase",
      }),
    );
    const f = await fixture(extract);
    let sent = "";
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
      sent = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(response());
    });
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    await worker.processBatch();
    expect(sent).toContain("Image A extracted text: first embedded phrase");
    expect(sent).toContain("Image B extracted text: second embedded phrase");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const { run } = (await f.runs())[0]!;
    expect(run.result.embeddedText).toMatchObject({
      version: EMBEDDED_TEXT_VERSION,
      images: [
        { status: "COMPLETE", characters: 21 },
        { status: "COMPLETE", characters: 22 },
      ],
    });
    const caches = await f.db.select().from(moderationProviderCallCache);
    expect(caches).toHaveLength(1);
    expect(JSON.stringify([run, caches])).not.toContain("embedded phrase");
    await f.writer.submitMemberIssue({ ...f.command, idempotencyKey: randomUUID() });
    await worker.dispatchBatch();
    await worker.processBatch();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(f.unused).not.toHaveBeenCalled();
  });

  it.each(["PARTIAL", "UNAVAILABLE", "WITHHELD_PII", "THROW"] as const)(
    "does not cache incomplete OCR %s or mistake it for approval",
    async (status) => {
      const f = await fixture(() =>
        status === "THROW"
          ? Promise.reject(new Error("private error"))
          : Promise.resolve({
              version: EMBEDDED_TEXT_VERSION,
              status,
              text: status === "PARTIAL" ? "partial words" : "must not leak",
            }),
      );
      let sent = "";
      const worker = f.worker(
        vi.fn((_url: unknown, init?: RequestInit) => {
          sent = typeof init?.body === "string" ? init.body : "";
          return Promise.resolve(response());
        }),
      );
      await worker.dispatchBatch();
      await worker.processBatch();
      expect(sent).not.toContain("must not leak");
      expect(sent).not.toContain("private error");
      expect(await f.db.select().from(moderationProviderCallCache)).toHaveLength(0);
      const { run } = (await f.runs())[0]!;
      expect(run.result.publicationReadiness).toMatchObject({ executionAuthorized: false });
      expect(JSON.stringify(run.result)).not.toContain("partial words");
      expect(f.unused).not.toHaveBeenCalled();
    },
  );

  function productionGate(dailyCap: number, circuitMinimum = 5) {
    return createModerationProviderGate({
      database: testDatabase.database.db,
      config: moderationProviderRuntimeConfig({
        MODERATION_PROVIDER_MODE: "SHADOW",
        MODERATION_PROVIDER: "OPENAI_MODERATION",
        OPENAI_API_KEY: "mock-only-key",
        MODERATION_PROVIDER_KILL_SWITCH: "false",
        MODERATION_PROVIDER_CANARY_PERCENT: "100",
        MODERATION_PROVIDER_DAILY_CALL_CAP: String(dailyCap),
        MODERATION_PROVIDER_CIRCUIT_MIN_CALLS: String(circuitMinimum),
        MODERATION_PROVIDER_APPROVAL_EVIDENCE:
          "dpaExecuted,noTrainingConfirmed,retentionTermsRecorded,deletionTermsRecorded,subprocessorsRecorded,processingRegionRecorded,encryptionConfirmed,credentialRotationOwnerAssigned,breachResponseRecorded,internationalTransferLegalReviewApproved,providerDataControlApproved",
      }),
    });
  }

  it("resolves exactly the requested question revision with both images ordered A then B", async () => {
    const f = await fixture();
    const firstTarget = await f.target();
    const first = await f.resolveInput(firstTarget);
    expect(first).toMatchObject({ scope: "SUBMISSION_REVISION", modality: "TEXT_AND_IMAGE" });
    expect(first.images).toHaveLength(2);
    expect(first.images![0]!.dataUrl).not.toBe(first.images![1]!.dataUrl);
    await f.writer.resubmitMemberIssue({
      ...f.command,
      question: "새로운 질문은 무엇이 좋을까요?",
      choiceA: "영화",
      choiceB: "음악",
      mediaAssetAId: f.assets[1]!.id,
      mediaAssetBId: f.assets[0]!.id,
      submissionId: f.submission.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    });
    const secondTarget = await f.target(2);
    const second = await f.resolveInput(secondTarget);
    expect(secondTarget.normalizedInputHash).not.toBe(firstTarget.normalizedInputHash);
    expect(second.text).toContain("A: 영화");
    expect(second.images![0]!.dataUrl).toBe(first.images![1]!.dataUrl);
    expect(await f.resolveInput(firstTarget)).toEqual(first);
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("never borrows a submission's text for an asset-only cached check", async () => {
    const f = await fixture();
    const [version] = await f.db
      .select()
      .from(issueMediaAssetVersions)
      .where(eq(issueMediaAssetVersions.assetId, f.assets[0]!.id));
    const input = await f.resolveInput({
      targetType: "ISSUE_MEDIA_ASSET",
      targetId: version!.assetId,
      targetVersion: 1,
      normalizedInputHash: version!.inputHash,
      policyVersion: MODERATION_POLICY_VERSION,
      privateObjectReference: version!.normalizedObjectRef,
    });
    expect(input).toMatchObject({ scope: "ASSET_ONLY", modality: "IMAGE" });
    expect(input.images).toHaveLength(1);
    expect(input.text).toBeUndefined();
    expect(input.context).toBeUndefined();
  });

  it.each(["BINARY", "OWNER", "PURGED", "RIGHTS", "MISSING_OBJECT"])(
    "fails closed for %s without calling OpenAI",
    async (mode) => {
      const f = await fixture();
      const id = f.assets[1]!.id;
      const key = `issue-media/staging/${id}.webp`;
      if (mode === "BINARY") f.objects.set(key, Buffer.from("wrong binary"));
      if (mode === "MISSING_OBJECT") f.objects.delete(key);
      if (mode === "OWNER")
        await f.db
          .update(issueMediaAssets)
          .set({ sourceType: "OPERATOR_UPLOAD" })
          .where(eq(issueMediaAssets.id, id));
      if (mode === "PURGED")
        await f.db
          .update(issueMediaAssets)
          .set({ storageState: "PURGED", stagingObjectKey: null, purgedAt: new Date() })
          .where(eq(issueMediaAssets.id, id));
      if (mode === "RIGHTS")
        await f.db
          .update(issueMediaAssets)
          .set({ rightsState: "CHALLENGED" })
          .where(eq(issueMediaAssets.id, id));
      const fetchImpl = vi.fn(() => Promise.resolve(response()));
      const adapter = createOpenAiModerationAdapter({
        apiKey: "mock-only-key",
        resolveInput: f.resolveInput,
        fetchImpl,
      });
      await expect(adapter.inspect(await f.target())).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("bypasses old caches and sends question plus each image in separately audited requests", async () => {
    const f = await fixture();
    const target = await f.target();
    await f.db.insert(moderationProviderCallCache).values({
      provider: "OPENAI_MODERATION",
      modelName: "omni-moderation",
      modelVersion: "omni-moderation-2024-09-26",
      policyVersion: target.policyVersion,
      normalizedInputHash: target.normalizedInputHash,
      status: "SUCCEEDED",
      result: { oldUnboundResult: true },
      latencyMs: 0,
      costMicros: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
    const requests: Array<{ model: string; input: Array<{ type: string; text?: string }> }> = [];
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
      requests.push(
        JSON.parse(typeof init?.body === "string" ? init.body : "{}") as (typeof requests)[number],
      );
      return Promise.resolve(response());
    });
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ succeeded: 1, skipped: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requests.map((request) => request.input.map((item) => item.type))).toEqual([
      ["text", "image_url"],
      ["text", "image_url"],
    ]);
    expect(requests[0]!.input[0]!.text).toContain(f.command.question);
    expect(requests[1]!.input[0]!.text).toBe(requests[0]!.input[0]!.text);
    expect(requests[1]!.input[1]).not.toEqual(requests[0]!.input[1]);
    const { run } = (await f.runs())[0]!;
    expect(run).toMatchObject({
      status: "SUCCEEDED",
      result: {
        inputScope: "SUBMISSION_REVISION",
        imageCount: 2,
        requestCount: 2,
        requestStrategy: "PER_IMAGE_V1",
        publicationChanged: false,
        publicationReadiness: {
          executionAuthorized: false,
          state: "PRIVATE_REVIEW_REQUIRED",
          blockers: expect.arrayContaining([
            "IMAGE_COVERAGE_INCOMPLETE",
            "A_VISUAL_ENGINE_NOT_IMPLEMENTED",
            "B_VISUAL_ENGINE_NOT_IMPLEMENTED",
          ]) as unknown,
          executionBlockers: expect.arrayContaining([
            "SHADOW_IS_NOT_EXECUTION_AUTHORITY",
          ]) as unknown,
        },
        inputBinding: {
          contractVersion: MODERATION_PROVIDER_INPUT_VERSION,
          targetVersion: 1,
          inputHash: target.normalizedInputHash,
        },
      },
    });
    expect(JSON.stringify(run.result)).not.toContain("base64");
    expect(JSON.stringify(run.result)).not.toContain(f.command.question);
    const audit = await f.db
      .select()
      .from(moderationAuditEvents)
      .where(eq(moderationAuditEvents.entityId, run.id));
    expect(
      audit.filter((event) => event.eventType === "PROVIDER_INSPECTION_ATTEMPTED"),
    ).toHaveLength(2);
    expect(
      audit.filter((event) => event.eventType === "PROVIDER_INSPECTION_COMPLETED"),
    ).toHaveLength(2);
    const diagnostic = await readLatestPublicationReadiness(f.db, f.submission.id);
    expect(diagnostic).toMatchObject({ runId: run.id, readiness: { executionAuthorized: false } });
    await f.writer.actOnMemberIssueSubmission({
      sessionToken: f.session.token,
      submissionId: f.submission.id,
      expectedRevision: 1,
      action: "CANCEL",
    });
    expect(await readLatestPublicationReadiness(f.db, f.submission.id)).toMatchObject({
      readiness: { blockers: expect.arrayContaining(["SUBMISSION_NOT_PENDING"]) as unknown },
    });
    expect(f.unused).not.toHaveBeenCalled();
  });

  it.each(["EDIT", "CANCEL", "HIDE", "LOST_LEASE"])(
    "discards a response made stale by %s during the request",
    async (mode) => {
      const f = await fixture();
      let changed = false;
      const fetchImpl = vi.fn(async () => {
        if (changed) return response();
        changed = true;
        if (mode === "EDIT")
          await f.writer.resubmitMemberIssue({
            ...f.command,
            question: "수정한 질문은 어떤가요?",
            submissionId: f.submission.id,
            expectedRevision: 1,
            idempotencyKey: randomUUID(),
          });
        if (mode === "CANCEL")
          await f.writer.actOnMemberIssueSubmission({
            sessionToken: f.session.token,
            submissionId: f.submission.id,
            expectedRevision: 1,
            action: "CANCEL",
          });
        if (mode === "HIDE")
          await f.db
            .update(issueMediaAssets)
            .set({
              storageState: "QUARANTINED",
              moderationState: "REVOKED",
              stagingObjectKey: null,
              quarantinedObjectKey: `issue-media/quarantine/${f.assets[1]!.id}.webp`,
            })
            .where(eq(issueMediaAssets.id, f.assets[1]!.id));
        if (mode === "LOST_LEASE") {
          const { run } = (await f.runs())[0]!;
          await f.db
            .update(moderationRuns)
            .set({ status: "PENDING", claimToken: null, claimedAt: null })
            .where(eq(moderationRuns.id, run.id));
        }
        return response();
      });
      const worker = f.worker(fetchImpl);
      await worker.dispatchBatch();
      expect(await worker.processBatch()).toMatchObject({ succeeded: 0, skipped: 3 });
      const { run } = (await f.runs())[0]!;
      expect(run.status).toBe(mode === "LOST_LEASE" ? "PENDING" : "SKIPPED");
      expect(run.result.signals).toBeUndefined();
      expect(run.result.publicationReadiness).toBeUndefined();
      if (mode !== "LOST_LEASE") expect(run.result.stale).toBe(true);
      expect(await f.db.select().from(moderationProviderCallCache)).toHaveLength(0);
      expect(await productionGate(1)(await f.target())).toMatchObject({
        allowed: false,
        reason: "DAILY_CALL_CAP_REACHED",
      });
      const [submission] = await f.db
        .select()
        .from(memberIssueSubmissions)
        .where(eq(memberIssueSubmissions.id, f.submission.id));
      expect(submission!.publishedIssueId).toBeNull();
      expect(f.unused).not.toHaveBeenCalled();
    },
  );

  it("does not execute an older queued revision and processes the new revision only", async () => {
    const f = await fixture();
    await f.writer.resubmitMemberIssue({
      ...f.command,
      question: "최신 질문의 선택은 무엇인가요?",
      submissionId: f.submission.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    });
    const fetchImpl = vi.fn(() => Promise.resolve(response()));
    const worker = f.worker(fetchImpl);
    expect(await worker.dispatchBatch()).toMatchObject({ skipped: 1, queued: 3 });
    expect(await worker.processBatch()).toMatchObject({ succeeded: 1, skipped: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await f.runs()).map(({ run }) => run.status).sort()).toEqual(["SKIPPED", "SUCCEEDED"]);
  });

  it("refreshes expired versioned cache entries and avoids duplicate concurrent execution", async () => {
    const f = await fixture();
    const target = await f.target();
    const hash = moderationProviderCacheHash({ ...target, cacheProfile: "default:per-image-v1" });
    await f.db.insert(moderationProviderCallCache).values({
      provider: "OPENAI_MODERATION",
      modelName: "omni-moderation",
      modelVersion: "omni-moderation-2024-09-26",
      policyVersion: target.policyVersion,
      normalizedInputHash: hash,
      status: "SUCCEEDED",
      result: { expired: true },
      latencyMs: 0,
      costMicros: 0,
      expiresAt: new Date(Date.now() - 60000),
    });
    const fetchImpl = vi.fn(() => Promise.resolve(response()));
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    await Promise.all([worker.processBatch(), worker.processBatch()]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [cached] = await f.db
      .select()
      .from(moderationProviderCallCache)
      .where(eq(moderationProviderCallCache.normalizedInputHash, hash));
    expect(cached!.result.expired).toBeUndefined();
    expect(cached!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(cached!.result.publicationReadiness).toBeUndefined();
    await f.db
      .update(moderationProviderCallCache)
      .set({
        result: {
          ...cached!.result,
          publicationReadiness: { executionAuthorized: true, state: "ALLOW" },
        },
      })
      .where(eq(moderationProviderCallCache.id, cached!.id));
    const next = await f.writer.submitMemberIssue({ ...f.command, idempotencyKey: randomUUID() });
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ succeeded: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readLatestPublicationReadiness(f.db, next.submission.id)).toMatchObject({
      readiness: { executionAuthorized: false, state: "PRIVATE_REVIEW_REQUIRED" },
    });
    expect(await productionGate(3)(target)).toMatchObject({ allowed: true });
    expect(await productionGate(2)(target)).toMatchObject({
      allowed: false,
      reason: "DAILY_CALL_CAP_REACHED",
    });
  });

  it("does not begin a two-image check when the daily budget has room for only one request", async () => {
    const f = await fixture();
    const fetchImpl = vi.fn(() => Promise.resolve(response()));
    const worker = f.worker(fetchImpl, (input) =>
      input.targetType === "ISSUE_VERSION"
        ? productionGate(1)(input)
        : { allowed: false, reason: "SUBMISSION_ONLY" },
    );
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ succeeded: 0, skipped: 3 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await f.runs())[0]!.run.result.reason).toBe("DAILY_CALL_CAP_REACHED");
    expect(
      await f.db
        .select()
        .from(moderationAuditEvents)
        .where(eq(moderationAuditEvents.eventType, "PROVIDER_INSPECTION_ATTEMPTED")),
    ).toHaveLength(0);
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("counts both HTTP attempts when B fails and never caches partial A evidence", async () => {
    const f = await fixture();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "invalid_image", message: "private-content" } }),
          { status: 400 },
        ),
      );
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({
      succeeded: 0,
      deadLettered: 1,
      skipped: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const { run } = (await f.runs())[0]!;
    const events = await f.db
      .select()
      .from(moderationAuditEvents)
      .where(eq(moderationAuditEvents.entityId, run.id));
    expect(
      events.filter((event) => event.eventType === "PROVIDER_INSPECTION_ATTEMPTED"),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event.eventType === "PROVIDER_INSPECTION_COMPLETED"),
    ).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "PROVIDER_INSPECTION_FAILED")).toHaveLength(
      1,
    );
    expect(await f.db.select().from(moderationProviderCallCache)).toHaveLength(0);
    expect(await productionGate(2)(await f.target())).toMatchObject({ allowed: false });
    expect(JSON.stringify([run, events])).not.toContain("private-content");
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("counts failed provider attempts toward the circuit without creating reusable results", async () => {
    const f = await fixture();
    const fetchImpl = vi.fn(() => Promise.reject(new DOMException("mock timeout", "TimeoutError")));
    const worker = f.worker(fetchImpl);
    await worker.dispatchBatch();
    expect(await worker.processBatch()).toMatchObject({ deadLettered: 1, skipped: 2 });
    expect(await productionGate(10, 1)(await f.target())).toMatchObject({
      allowed: false,
      reason: "PROVIDER_CIRCUIT_OPEN",
    });
    expect(await f.db.select().from(moderationProviderCallCache)).toHaveLength(0);
    expect(await readLatestPublicationReadiness(f.db, f.submission.id)).toMatchObject({
      runStatus: "DEAD_LETTERED",
      readiness: {
        executionAuthorized: false,
        blockers: expect.arrayContaining([
          "PROVIDER_NOT_SUCCEEDED",
          "PROVIDER_RESULT_INVALID",
        ]) as unknown,
      },
    });
    expect(f.unused).not.toHaveBeenCalled();
  });

  it("redacts contact information in immutable image submission context", async () => {
    const f = await fixture();
    // Simulate an imported immutable revision; normal authoring rules may already reject PII.
    await f.db
      .update(memberIssueSubmissionRevisions)
      .set({ context: "reach@example.com https://example.com 010-1234-5678" })
      .where(eq(memberIssueSubmissionRevisions.submissionId, f.submission.id));
    const input = await f.resolveInput(await f.target());
    expect(input.text).toContain("[EMAIL_REDACTED]");
    expect(input.text).not.toContain("reach@example.com");
    expect(input.text).not.toContain("010-1234-5678");
  });
});
