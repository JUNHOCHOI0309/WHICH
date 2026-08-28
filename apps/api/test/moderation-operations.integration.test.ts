import { randomUUID } from "node:crypto";

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueMediaAssets,
  issueMediaReviewDecisions,
  members,
  moderationActions,
  moderationAuditEvents,
  moderationCaseReferences,
  moderationCases,
  moderationReconciliations,
  moderationRuns,
} from "../src/database/schema/index.js";
import {
  createModerationOperationsService,
  type ModerationOperationsError,
} from "../src/modules/moderation-operations/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
}, 30_000);

describe("WHICH-94 moderation Run, Case, and Action model", () => {
  it("supports every immutable target type and rejects changed evidence for one version", async () => {
    const service = createModerationOperationsService(database.db);
    for (const targetType of [
      "COMMENT_VERSION",
      "ISSUE_VERSION",
      "ISSUE_MEDIA_ASSET",
      "PROFILE_VERSION",
    ] as const) {
      const command = {
        targetType,
        targetId: randomUUID(),
        targetVersion: 1,
        inputHash: "1".repeat(64),
        snapshotReference: `db://immutable/${targetType}/1`,
      };
      const first = await service.registerTarget(command);
      expect(first.created).toBe(true);
      await expect(service.registerTarget(command)).resolves.toEqual({
        created: false,
        id: first.id,
      });
      await expect(
        service.registerTarget({ ...command, inputHash: "f".repeat(64) }),
      ).rejects.toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
        statusCode: 409,
      } satisfies Partial<ModerationOperationsError>);
    }
  });

  it("deduplicates one charged execution by target, policy, stage, and normalized hash", async () => {
    const service = createModerationOperationsService(database.db);
    const target = await service.registerTarget({
      targetType: "ISSUE_VERSION",
      targetId: randomUUID(),
      targetVersion: 2,
      inputHash: "a".repeat(64),
      snapshotReference: "db://issue-version-snapshots/example/2",
    });
    const command = {
      targetId: target.id,
      policyVersion: "moderation-policy-v4",
      stage: "MULTIMODAL_CLASSIFICATION",
      normalizedInputHash: "b".repeat(64),
      modelProvider: "TEST_PROVIDER",
      modelName: "moderator",
      modelVersion: "2026-08-29",
      ruleVersion: "rules-v3",
      status: "SUCCEEDED" as const,
      decisionSource: "MODEL" as const,
      result: { lane: "LOW", score: 0.08 },
      latencyMs: 143,
      costMicros: 27,
      completedAt: new Date(),
    };

    const first = await service.recordRun(command);
    const repeated = await service.recordRun(command);
    expect(first.created).toBe(true);
    expect(repeated).toEqual({ created: false, id: first.id });
    const [runCount] = await database.db
      .select({ value: count() })
      .from(moderationRuns)
      .where(eq(moderationRuns.targetId, target.id));
    expect(runCount?.value).toBe(1);

    const [stored] = await database.db
      .select()
      .from(moderationRuns)
      .where(eq(moderationRuns.id, first.id));
    expect(stored).toMatchObject({
      policyVersion: "moderation-policy-v4",
      ruleVersion: "rules-v3",
      stage: "MULTIMODAL_CLASSIFICATION",
      latencyMs: 143,
      costMicros: 27,
      decisionSource: "MODEL",
    });
  });

  it("uses optimistic Case revisions and links reports, rights, appeals, and reconciliation", async () => {
    const service = createModerationOperationsService(database.db);
    const target = await service.registerTarget({
      targetType: "PROFILE_VERSION",
      targetId: randomUUID(),
      targetVersion: 3,
      inputHash: "c".repeat(64),
      snapshotReference: "db://profile-revisions/example/3",
    });
    const moderationCase = await service.openCase({
      targetId: target.id,
      riskLane: "HIGH",
      priority: "P1",
      slaDueAt: new Date(Date.now() + 60_000),
    });
    expect(moderationCase.expectedRevision).toBe(1);
    const updated = await service.updateCase({
      caseId: moderationCase.id,
      expectedRevision: 1,
      status: "IN_REVIEW",
      priority: "P0",
    });
    expect(updated.expectedRevision).toBe(2);
    await expect(
      service.updateCase({
        caseId: moderationCase.id,
        expectedRevision: 1,
        status: "RESOLVED",
      }),
    ).rejects.toMatchObject({
      code: "CASE_REVISION_CONFLICT",
      statusCode: 409,
    } satisfies Partial<ModerationOperationsError>);

    for (const referenceType of [
      "CONTENT_REPORT",
      "COMMENT_REPORT",
      "RIGHTS_REQUEST",
      "APPEAL",
      "RECONCILIATION",
    ] as const) {
      const linked = await service.linkCaseReference({
        caseId: moderationCase.id,
        referenceType,
        referenceId: randomUUID(),
      });
      expect(linked.created).toBe(true);
    }
    const [referenceCount] = await database.db
      .select({ value: count() })
      .from(moderationCaseReferences)
      .where(eq(moderationCaseReferences.caseId, moderationCase.id));
    expect(referenceCount?.value).toBe(5);
  });

  it("records only canonical domain decision references and creates reconciliation audit events", async () => {
    const service = createModerationOperationsService(database.db);
    const [operator] = await database.db
      .insert(members)
      .values({ displayName: "WHICH-94 operator" })
      .returning();
    if (!operator) throw new Error("Operator fixture was not created.");
    const [asset] = await database.db
      .insert(issueMediaAssets)
      .values({
        uploadedByMemberId: operator.id,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "Original test fixture with documented publication rights.",
        rightsAttestedAt: new Date(),
        sha256: "d".repeat(64),
        perceptualHash: "e".repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 64,
        inputHeight: 64,
        outputByteSize: 50,
        outputWidth: 64,
        outputHeight: 64,
        stagingObjectKey: "test/which-94.webp",
      })
      .returning();
    if (!asset) throw new Error("Asset fixture was not created.");
    const [decision] = await database.db
      .insert(issueMediaReviewDecisions)
      .values({
        scope: "ASSET",
        mediaAssetId: asset.id,
        status: "APPROVED",
        reasonCode: "SAFE_TEST_FIXTURE",
        rationale: "The fixture satisfies the minimum moderation review rationale.",
        policyVersion: "moderation-policy-v4",
        reviewedByMemberId: operator.id,
        requestId: randomUUID(),
      })
      .returning();
    if (!decision) throw new Error("Decision fixture was not created.");
    const target = await service.registerTarget({
      targetType: "ISSUE_MEDIA_ASSET",
      targetId: asset.id,
      targetVersion: 1,
      inputHash: "d".repeat(64),
      snapshotReference: `r2://staging/${asset.stagingObjectKey}`,
    });
    const moderationCase = await service.openCase({
      targetId: target.id,
      riskLane: "LOW",
      priority: "P2",
      assignedToMemberId: operator.id,
    });

    const action = await service.recordAction({
      caseId: moderationCase.id,
      actionType: "PUBLISH_MEDIA",
      domainDecisionType: "ISSUE_MEDIA_REVIEW_DECISION",
      domainDecisionId: decision.id,
      actorType: "OPERATOR",
      actorMemberId: operator.id,
      beforeState: { storage: "STAGED" },
      afterState: { storage: "PUBLISHED" },
      noticeKey: "issue-media-approved",
    });
    const [storedAction] = await database.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, action.id));
    expect(storedAction).toMatchObject({
      domainDecisionId: decision.id,
      domainDecisionType: "ISSUE_MEDIA_REVIEW_DECISION",
      noticeKey: "issue-media-approved",
    });

    const reconciliation = await service.recordReconciliation({
      caseId: moderationCase.id,
      targetId: target.id,
      resourceType: "R2",
      expectedReference: "r2://published/which-94.webp",
      observedReference: "r2://staging/which-94.webp",
      repairReference: "repair://job/which-94",
      status: "REPAIRED",
      actorType: "SYSTEM",
      resolvedAt: new Date(),
    });
    const [storedReconciliation] = await database.db
      .select()
      .from(moderationReconciliations)
      .where(eq(moderationReconciliations.id, reconciliation.id));
    expect(storedReconciliation).toMatchObject({
      status: "REPAIRED",
      repairReference: "repair://job/which-94",
    });
    const [audit] = await database.db
      .select()
      .from(moderationAuditEvents)
      .where(eq(moderationAuditEvents.entityId, reconciliation.id));
    expect(audit).toMatchObject({
      eventType: "RECONCILIATION_REPAIRED",
      actorType: "SYSTEM",
    });

    const [storedCase] = await database.db
      .select()
      .from(moderationCases)
      .where(eq(moderationCases.id, moderationCase.id));
    expect(storedCase?.targetId).toBe(target.id);
  });
});
