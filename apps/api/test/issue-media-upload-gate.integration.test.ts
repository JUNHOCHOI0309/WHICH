import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueMediaAssets,
  memberCapabilityGrants,
  memberIssueSubmissions,
  memberMediaConsents,
  members,
} from "../src/database/schema/index.js";
import {
  createIssueMediaUploadGateService,
  type IssueMediaUploadGateError,
} from "../src/modules/issue-media/upload-gate-service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;
const memberId = randomUUID();
const submissionId = randomUUID();

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  await database.db.insert(members).values({ id: memberId, displayName: "Pilot Member" });
  await database.db.insert(memberIssueSubmissions).values({
    id: submissionId,
    memberId,
    idempotencyKey: randomUUID(),
    status: "PENDING",
    question: "이미지 선택지를 검수할까요?",
    choiceA: "네",
    choiceB: "아니요",
    interestCardCode: "DAILY_LIFE",
    contentHash: "a".repeat(64),
  });
  await database.db.insert(memberCapabilityGrants).values({
    memberId,
    capabilityCode: "ISSUE_IMAGE_UPLOAD",
    state: "ACTIVE",
    policyVersion: "which-trusted-image-uploader-v1",
    reason: "Approved for the limited image pilot.",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
  });
  await database.db.insert(memberMediaConsents).values({
    memberId,
    consentVersion: "which-media-consent-v1",
  });
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("Issue media upload session service", () => {
  it("exposes Pilot access without leaking the grant rationale", async () => {
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "PILOT",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });
    await expect(service.readAccess(memberId)).resolves.toMatchObject({
      mode: "PILOT",
      allowed: true,
      reasons: [],
      capability: { state: "ACTIVE" },
      limits: { dailyUploads: null, maximumOpenAssets: null, maximumBytes: 10 * 1024 * 1024 },
    });
  });

  it("records the current consent once and restores a previously revoked consent", async () => {
    await database.db
      .update(memberMediaConsents)
      .set({ revokedAt: new Date(Date.now() + 1_000) })
      .where(eq(memberMediaConsents.memberId, memberId));
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "PILOT",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });
    await expect(service.readAccess(memberId)).resolves.toMatchObject({
      allowed: false,
      reasons: ["CONSENT_REQUIRED"],
    });
    await expect(service.acceptConsent(memberId)).resolves.toMatchObject({
      allowed: true,
      reasons: [],
    });
  });

  it("allows an active Member to upload without a Pilot capability", async () => {
    const regularMemberId = randomUUID();
    const regularSubmissionId = randomUUID();
    await database.db.insert(members).values({
      id: regularMemberId,
      displayName: "Regular Member",
    });
    await database.db.insert(memberIssueSubmissions).values({
      id: regularSubmissionId,
      memberId: regularMemberId,
      idempotencyKey: randomUUID(),
      status: "PENDING",
      question: "Member도 이미지를 직접 올릴 수 있나요?",
      choiceA: "네",
      choiceB: "아니요",
      interestCardCode: "DAILY_LIFE",
      contentHash: "b".repeat(64),
    });
    await database.db.insert(memberMediaConsents).values({
      memberId: regularMemberId,
      consentVersion: "which-media-consent-v1",
    });
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "MEMBER",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });

    await expect(service.readAccess(regularMemberId)).resolves.toMatchObject({
      mode: "MEMBER",
      allowed: true,
      reasons: [],
      capability: null,
    });
    const session = await service.createSession({
      memberId: regularMemberId,
      submissionId: regularSubmissionId,
      consentVersion: "which-media-consent-v1",
      ipAddress: "203.0.113.7",
    });
    await expect(
      service.consumeSession({
        memberId: regularMemberId,
        sessionId: session.id,
        token: session.token,
        byteSize: 1024,
      }),
    ).resolves.toEqual({ objectKey: session.objectKey });
  });

  it("pauses new sessions when Moderation capacity is fail-closed", async () => {
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "PILOT",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
      moderationCapacity: () => Promise.resolve({ allowed: false }),
    });
    await expect(
      service.createSession({
        memberId,
        submissionId,
        consentVersion: "which-media-consent-v1",
        ipAddress: "203.0.113.4",
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_UPLOAD_NOT_AVAILABLE",
      reasons: ["MODERATION_CAPACITY_PAUSED"],
      message:
        "이미지 안전 검사 시스템을 점검하고 있어 새 이미지 업로드를 잠시 중단했어요. 잠시 후 다시 시도해 주세요.",
    } satisfies Partial<IssueMediaUploadGateError>);
  });

  it("fails closed while the server mode is OFF", async () => {
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "OFF",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });
    await expect(
      service.createSession({
        memberId,
        submissionId,
        consentVersion: "which-media-consent-v1",
        ipAddress: "203.0.113.5",
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_UPLOAD_NOT_AVAILABLE",
      reasons: ["MODE_DISABLED"],
    } satisfies Partial<IssueMediaUploadGateError>);
  });

  it("creates a short-lived session and consumes it exactly once", async () => {
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "PILOT",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });
    const session = await service.createSession({
      memberId,
      submissionId,
      consentVersion: "which-media-consent-v1",
      ipAddress: "203.0.113.6",
    });
    expect(session).toMatchObject({
      maxBytes: 10 * 1024 * 1024,
      policyVersion: "which-member-media-upload-v1",
    });
    expect(session.objectKey).toContain(`${memberId}/${session.id}/source`);
    expect(session.token).toHaveLength(43);

    const secondSession = await service.createSession({
      memberId,
      submissionId,
      consentVersion: "which-media-consent-v1",
      ipAddress: "203.0.113.6",
    });
    await expect(
      service.createSession({
        memberId,
        submissionId,
        consentVersion: "which-media-consent-v1",
        ipAddress: "203.0.113.6",
      }),
    ).rejects.toMatchObject({ reasons: ["CONCURRENT_SESSION_LIMIT"] });

    await expect(
      service.consumeSession({
        memberId,
        sessionId: session.id,
        token: "wrong-token".repeat(4),
        byteSize: 1024,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UPLOAD_SESSION_INVALID" });
    await expect(
      service.consumeSession({
        memberId,
        sessionId: secondSession.id,
        token: secondSession.token,
        byteSize: 1024,
      }),
    ).resolves.toEqual({ objectKey: secondSession.objectKey });
    await expect(
      service.consumeSession({
        memberId,
        sessionId: session.id,
        token: session.token,
        byteSize: 1024,
      }),
    ).resolves.toEqual({ objectKey: session.objectKey });
    await expect(
      service.consumeSession({
        memberId,
        sessionId: session.id,
        token: session.token,
        byteSize: 1024,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UPLOAD_SESSION_INVALID" });
  });

  it("allows repeated uploads beyond the former Member, IP and stored-asset quotas", async () => {
    await database.db.insert(issueMediaAssets).values(
      Array.from({ length: 11 }, () => {
        const id = randomUUID();
        return {
          id,
          uploadedByMemberId: memberId,
          sourceType: "MEMBER_SUBMISSION",
          rightsAttestation: "The member accepted the current image processing policy.",
          rightsAttestedAt: new Date(),
          sha256: id.replaceAll("-", "").repeat(2),
          perceptualHash: "a".repeat(16),
          inputMimeType: "image/png",
          inputByteSize: 100,
          inputWidth: 10,
          inputHeight: 10,
          outputByteSize: 80,
          outputWidth: 10,
          outputHeight: 10,
          stagingObjectKey: `issue-media/staging/${id}.webp`,
          stagedAt: new Date(),
        };
      }),
    );
    const service = createIssueMediaUploadGateService(database.db, {
      mode: "PILOT",
      consentVersion: "which-media-consent-v1",
      pseudonymSecret: "test-pseudonym-secret-long-enough",
    });
    for (let index = 0; index < 14; index += 1) {
      const session = await service.createSession({
        memberId,
        submissionId,
        consentVersion: "which-media-consent-v1",
        ipAddress: "203.0.113.6",
      });
      await expect(
        service.consumeSession({
          memberId,
          sessionId: session.id,
          token: session.token,
          byteSize: 1024,
        }),
      ).resolves.toEqual({ objectKey: session.objectKey });
    }
  }, 30_000);
});
