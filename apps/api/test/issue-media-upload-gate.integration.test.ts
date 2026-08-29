import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
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
      limits: { dailyUploads: 3, maximumOpenAssets: 10, maximumBytes: 10 * 1024 * 1024 },
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
});
