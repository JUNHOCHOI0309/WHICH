import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueMediaAssets,
  issueMediaReviewDecisions,
  issueMediaRuleFindings,
  members,
  moderationAuditEvents,
  moderationReviewerAssistReviews,
  operatorAccessGrants,
} from "../src/database/schema/index.js";
import type { CommentService } from "../src/modules/comments/contracts.js";
import type { IssueMediaReviewService } from "../src/modules/issue-media/review-contracts.js";
import { createOpsModerationQueueService } from "../src/modules/operations/moderation-queue-service.js";
import {
  moderationProviderRuntimeConfig,
  providerRuntimeDiagnostic,
} from "../src/modules/moderation-providers/runtime-gate.js";
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

describe("WHICH-102 Ops AI Reviewer Assist", () => {
  it("keeps Random Audit AI evidence blind until a provisional human label is audited", async () => {
    const [operator] = await database.db
      .insert(members)
      .values({ displayName: "WHICH-102 operator" })
      .returning();
    if (!operator) throw new Error("Operator fixture was not created.");
    await database.db.insert(operatorAccessGrants).values({
      memberId: operator.id,
      grantedBy: "WHICH-102 test",
    });
    const [asset] = await database.db
      .insert(issueMediaAssets)
      .values({
        uploadedByMemberId: operator.id,
        sourceType: "MEMBER_SUBMISSION",
        rightsAttestation: "The test uploader asserted sufficient publication rights.",
        rightsAttestedAt: new Date(),
        sha256: `00${"1".repeat(62)}`,
        perceptualHash: "2".repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 200,
        inputWidth: 100,
        inputHeight: 100,
        outputByteSize: 100,
        outputWidth: 100,
        outputHeight: 100,
        moderationState: "APPROVED",
        storageState: "PUBLISHED",
        publishedObjectKey: "published/which-102.webp",
        publishedAt: new Date(),
      })
      .returning();
    if (!asset) throw new Error("Asset fixture was not created.");
    const [finding] = await database.db
      .insert(issueMediaRuleFindings)
      .values({
        mediaAssetId: asset.id,
        stage: "PROVIDER_SHADOW",
        code: "MEDIA_AI_SEXUAL",
        severity: "REVIEW",
        sourceVersion: "OPENAI:omni-moderation-test",
        evidence: {
          score: 0.91,
          flagged: true,
          calibratedBand: "HIGH",
          regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
        },
      })
      .returning();
    if (!finding) throw new Error("Finding fixture was not created.");

    const mediaReview = {
      readAssets() {
        return Promise.resolve({
          schemaVersion: 1 as const,
          generatedAt: new Date().toISOString(),
          counts: { PENDING: 0, APPROVED: 1, REJECTED: 0, HIDDEN: 0, DELETED: 0 },
          items: [
            {
              id: asset.id,
              sha256: asset.sha256,
              effectiveStatus: "APPROVED",
              rightsState: "ASSERTED",
              findings: [
                {
                  id: finding.id,
                  stage: finding.stage,
                  code: finding.code,
                  severity: "REVIEW",
                  sourceVersion: finding.sourceVersion,
                  evidence: finding.evidence,
                  createdAt: finding.createdAt.toISOString(),
                },
              ],
            },
          ],
        });
      },
      readRightsRequests() {
        return Promise.resolve([]);
      },
      async decideAsset(input: {
        memberId: string;
        assetId: string;
        status: "APPROVED" | "REJECTED" | "HIDDEN" | "RESTORED" | "DELETED";
        reasonCode: string;
        rationale: string;
        policyVersion: string;
        requestId: string;
      }) {
        const [decision] = await database.db
          .insert(issueMediaReviewDecisions)
          .values({
            scope: "ASSET",
            mediaAssetId: input.assetId,
            status: input.status,
            reasonCode: input.reasonCode,
            rationale: input.rationale,
            policyVersion: input.policyVersion,
            reviewedByMemberId: input.memberId,
            requestId: input.requestId,
          })
          .returning();
        if (!decision) throw new Error("Decision fixture was not created.");
        return {
          effectiveStatus: input.status === "RESTORED" ? "APPROVED" : input.status,
          latestDecision: {
            id: decision.id,
            status: input.status,
          },
        };
      },
    } as unknown as IssueMediaReviewService;
    const comments = {
      listModerationCases() {
        return Promise.resolve({ items: [] });
      },
    } as unknown as CommentService;
    const runtime = providerRuntimeDiagnostic(
      moderationProviderRuntimeConfig({
        MODERATION_PROVIDER_MODE: "OFF",
        MODERATION_PROVIDER: "NONE",
        MODERATION_PROVIDER_KILL_SWITCH: "true",
      }),
    );
    const service = createOpsModerationQueueService(database.db, mediaReview, comments, runtime);

    const blind = await service.readQueue({
      memberId: operator.id,
      limit: 25,
      requestId: randomUUID(),
    });
    expect(blind?.items).toHaveLength(1);
    const blindItem = blind!.items[0]!;
    expect(blindItem.lane).toBe("RANDOM_AUDIT");
    expect(blindItem.reviewerAssist).toMatchObject({
      requiresProvisionalLabel: true,
      provisionalLabel: null,
      recommendationVisible: false,
      recommendation: null,
    });
    if (blindItem.context.kind !== "IMAGE") throw new Error("Expected image context.");
    expect(blindItem.context.evidenceGroups.SAFETY_MODEL).toEqual([]);

    await service.recordView({
      memberId: operator.id,
      caseId: blindItem.caseId,
      eventType: "CASE_VIEWED",
      requestId: randomUUID(),
    });
    await service.recordProvisionalLabel({
      memberId: operator.id,
      caseId: blindItem.caseId,
      label: "ALLOW",
      rationale: "AI 근거를 보기 전 사람의 독립 판단입니다.",
      requestId: randomUUID(),
    });

    const revealed = await service.readQueue({
      memberId: operator.id,
      limit: 25,
      requestId: randomUUID(),
    });
    const revealedItem = revealed!.items[0]!;
    expect(revealedItem.reviewerAssist).toMatchObject({
      provisionalLabel: "ALLOW",
      recommendationVisible: true,
      recommendation: { label: "REVIEW", confidence: 0.91 },
    });
    if (revealedItem.context.kind !== "IMAGE") throw new Error("Expected image context.");
    expect(revealedItem.context.evidenceGroups.SAFETY_MODEL[0]).toMatchObject({
      code: "MEDIA_AI_SEXUAL",
      regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    });

    const [stored] = await database.db
      .select()
      .from(moderationReviewerAssistReviews)
      .where(eq(moderationReviewerAssistReviews.caseId, blindItem.caseId));
    expect(stored).toMatchObject({
      operatorMemberId: operator.id,
      provisionalLabel: "ALLOW",
      recommendationSnapshot: { label: "REVIEW", confidence: 0.91 },
    });
    expect(stored?.aiRevealedAt).toBeInstanceOf(Date);
    const audit = await database.db
      .select()
      .from(moderationAuditEvents)
      .where(eq(moderationAuditEvents.entityId, blindItem.caseId));
    expect(audit.map((event) => event.eventType)).toContain("PROVISIONAL_LABEL_RECORDED");

    await service.decide({
      memberId: operator.id,
      caseId: blindItem.caseId,
      decision: {
        expectedRevision: blindItem.expectedRevision,
        action: "APPROVED",
        reasonCode: "OPS_EXCEPTION_REVIEW",
        rationale: "사람의 독립 판단에 따라 게시 가능한 이미지로 최종 판정했습니다.",
        policyVersion: "ops-moderation-queue-v1",
      },
      reviewerAssist: {
        agreement: "OVERRIDE",
        overrideDirection: "REVIEW_TO_APPROVED",
      },
      requestId: randomUUID(),
    });
    const [completed] = await database.db
      .select()
      .from(moderationReviewerAssistReviews)
      .where(eq(moderationReviewerAssistReviews.caseId, blindItem.caseId));
    expect(completed).toMatchObject({
      provisionalLabel: "ALLOW",
      finalAction: "APPROVED",
      agreement: "OVERRIDE",
      overrideDirection: "REVIEW_TO_APPROVED",
    });
    expect(completed?.completedAt).toBeInstanceOf(Date);
    expect(completed?.reviewDurationSeconds).toBeGreaterThanOrEqual(0);
  });
});
