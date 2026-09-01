import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueMediaAssets,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  memberModerationNotices,
  members,
  moderationAuditEvents,
  moderationCaseReferences,
} from "../src/database/schema/index.js";
import { createMemberModerationService } from "../src/modules/member-moderation/service.js";
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

async function asset(memberId: string, marker: string) {
  const [row] = await database.db
    .insert(issueMediaAssets)
    .values({
      uploadedByMemberId: memberId,
      sourceType: "MEMBER_SUBMISSION",
      rightsAttestation: "I own the publication rights for this original test image.",
      rightsAttestedAt: new Date(),
      sha256: marker.repeat(64),
      perceptualHash: marker.repeat(16),
      inputMimeType: "image/png",
      inputByteSize: 512,
      inputWidth: 256,
      inputHeight: 256,
      outputByteSize: 256,
      outputWidth: 256,
      outputHeight: 256,
      stagingObjectKey: `member/${marker}.webp`,
      stagedAt: new Date(),
    })
    .returning();
  return row!;
}

describe("WHICH-96 member moderation experience", () => {
  it("separates publication and asset states and connects appeals and rights to the ops case", async () => {
    const [member] = await database.db
      .insert(members)
      .values({ displayName: "WHICH-96 member" })
      .returning();
    const first = await asset(member!.id, "a");
    const second = await asset(member!.id, "b");
    const submissionId = randomUUID();
    await database.db.insert(memberIssueSubmissions).values({
      id: submissionId,
      memberId: member!.id,
      idempotencyKey: randomUUID(),
      question: "이미지가 기다리는 동안 질문은 어떻게 할까요?",
      choiceA: "텍스트로 계속",
      choiceB: "이미지를 기다림",
      mediaAssetAId: first.id,
      mediaAssetBId: second.id,
      interestCardCode: "DAILY_LIFE",
      contentHash: "c".repeat(64),
    });

    const service = createMemberModerationService(database.db);
    const initial = await service.readCenter(member!.id);
    expect(initial.assets[0]?.assetReview.status).toBe("PENDING");
    expect(initial.assets[0]?.issueSubmission?.publicationStatus).toBe("PENDING");

    const appeal = await service.createAppeal({
      memberId: member!.id,
      targetType: "ISSUE_MEDIA_ASSET",
      targetId: first.id,
      reason: "이 이미지는 직접 만든 원본이고 정책 위반 요소가 없어 사람 재검토를 요청합니다.",
    });
    const repeated = await service.createAppeal({
      memberId: member!.id,
      targetType: "ISSUE_MEDIA_ASSET",
      targetId: first.id,
      reason: "같은 대상의 중복 접수는 기존 재검토 사건으로 귀결되어야 합니다.",
    });
    expect(repeated.id).toBe(appeal.id);
    const rights = await service.createRightsCase({
      memberId: member!.id,
      requestType: "COPYRIGHT",
      targetType: "ISSUE_MEDIA_ASSET",
      targetId: first.id,
      details: "원본 제작자이며 해당 이미지의 게시와 보호에 필요한 권리를 보유하고 있습니다.",
      evidence: { reference: "test-evidence" },
    });
    expect(rights.dueAt).not.toBeNull();
    expect(rights.legalHoldUntil).not.toBeNull();
    expect(new Date(rights.legalHoldUntil!).getTime()).toBeGreaterThan(
      new Date(rights.dueAt!).getTime(),
    );

    const [appealReference] = await database.db
      .select()
      .from(moderationCaseReferences)
      .where(
        and(
          eq(moderationCaseReferences.referenceType, "APPEAL"),
          eq(moderationCaseReferences.referenceId, appeal.id),
        ),
      );
    const [rightsReference] = await database.db
      .select()
      .from(moderationCaseReferences)
      .where(
        and(
          eq(moderationCaseReferences.referenceType, "RIGHTS_REQUEST"),
          eq(moderationCaseReferences.referenceId, rights.id),
        ),
      );
    expect(appealReference?.caseId).toBe(rightsReference?.caseId);

    const center = await service.readCenter(member!.id);
    expect(center.appeals).toHaveLength(1);
    expect(center.rightsCases).toHaveLength(1);
    expect(center.notices.map((notice) => notice.reasonCode)).toEqual(
      expect.arrayContaining(["APPEAL_SUBMITTED", "COPYRIGHT_RIGHTS_SUBMITTED"]),
    );
    const notifications = await service.readNotifications(member!.id);
    expect(notifications.unreadCount).toBe(2);
    expect(notifications.items.every((notice) => notice.readAt === null)).toBe(true);

    const [otherMember] = await database.db
      .insert(members)
      .values({ displayName: "WHICH-143 other member" })
      .returning();
    const [otherNotice] = await database.db
      .insert(memberModerationNotices)
      .values({
        memberId: otherMember!.id,
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: first.id,
        policyVersion: "which-moderation-v1",
        reasonCode: "TEST_OTHER_MEMBER",
        actionType: "REVIEWED",
        summary: "다른 회원의 알림",
        nextStep: "현재 회원에게 노출되거나 읽음 처리되면 안 됩니다.",
        effectiveAt: new Date(),
      })
      .returning();
    await expect(service.markNotificationsRead(member!.id, [otherNotice!.id])).resolves.toEqual({
      updated: 0,
    });
    await expect(
      service.markNotificationsRead(
        member!.id,
        notifications.items.map((notice) => notice.id),
      ),
    ).resolves.toEqual({ updated: 2 });
    const clearedNotifications = await service.readNotifications(member!.id);
    expect(clearedNotifications.unreadCount).toBe(0);
    expect(clearedNotifications.items).toEqual([]);
    const [unaffected] = await database.db
      .select()
      .from(memberModerationNotices)
      .where(eq(memberModerationNotices.id, otherNotice!.id));
    expect(unaffected?.readAt).toBeNull();

    const [audit] = await database.db
      .select()
      .from(moderationAuditEvents)
      .where(eq(moderationAuditEvents.entityId, appeal.id));
    expect(audit).toMatchObject({ eventType: "APPEAL_SUBMITTED", actorType: "MEMBER" });
  });

  it("creates an immutable revision when a pending image is removed for text-only review", async () => {
    const [member] = await database.db
      .insert(members)
      .values({ displayName: "WHICH-96 alternative member" })
      .returning();
    const first = await asset(member!.id, "d");
    const second = await asset(member!.id, "e");
    const third = await asset(member!.id, "f");
    const fourth = await asset(member!.id, "7");
    const contextAsset = await asset(member!.id, "8");
    const submissionId = randomUUID();
    await database.db.insert(memberIssueSubmissions).values({
      id: submissionId,
      memberId: member!.id,
      idempotencyKey: randomUUID(),
      question: "이미지 없이 질문을 계속 검토할까요?",
      context: "네 가지 선택지와 맥락 이미지가 있는 질문입니다.",
      contextMediaAssetId: contextAsset.id,
      choiceA: "계속",
      choiceB: "취소",
      choiceC: "보류",
      choiceD: "다시 선택",
      mediaAssetAId: first.id,
      mediaAssetBId: second.id,
      mediaAssetCId: third.id,
      mediaAssetDId: fourth.id,
      interestCardCode: "DAILY_LIFE",
      contentHash: "f".repeat(64),
    });
    const service = createMemberModerationService(database.db);
    await expect(
      service.chooseAssetAlternative({
        memberId: member!.id,
        submissionId,
        action: "TEXT_ONLY",
      }),
    ).resolves.toEqual({ updated: true, revision: 2 });
    const [updated] = await database.db
      .select()
      .from(memberIssueSubmissions)
      .where(eq(memberIssueSubmissions.id, submissionId));
    expect(updated).toMatchObject({
      revision: 2,
      choiceC: "보류",
      choiceD: "다시 선택",
      contextMediaAssetId: null,
      mediaAssetAId: null,
      mediaAssetBId: null,
      mediaAssetCId: null,
      mediaAssetDId: null,
    });
    const [revision] = await database.db
      .select()
      .from(memberIssueSubmissionRevisions)
      .where(
        and(
          eq(memberIssueSubmissionRevisions.submissionId, submissionId),
          eq(memberIssueSubmissionRevisions.revision, 2),
        ),
      );
    expect(revision).toMatchObject({
      choiceC: "보류",
      choiceD: "다시 선택",
      contextMediaAssetId: null,
      mediaAssetAId: null,
      mediaAssetBId: null,
      mediaAssetCId: null,
      mediaAssetDId: null,
    });
  });
});
