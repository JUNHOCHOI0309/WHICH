import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  memberCapabilityEvents,
  memberCapabilityGrants,
  memberCredentials,
  memberIssueSubmissions,
  memberMediaConsents,
  members,
  operatorAuditLogs,
} from "../src/database/schema/index.js";
import { createIssueMediaUploadGateService } from "../src/modules/issue-media/upload-gate-service.js";
import {
  decideUploadOnlyAccess,
  UPLOAD_ONLY_POLICY_VERSION,
} from "../src/modules/operations/upload-only-access.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let drop: () => Promise<void>;
beforeAll(async () => {
  const test = await createTestDatabase();
  database = test.database;
  drop = () => test.drop();
}, 30_000);
afterAll(async () => {
  await database.close();
  await drop();
});

async function member(verified = true) {
  const id = randomUUID();
  await database.db.insert(members).values({ id, displayName: "Upload-only test" });
  await database.db.insert(memberCredentials).values({
    memberId: id,
    emailNormalized: `${id}@example.test`,
    passwordHash: "test-not-a-password",
    emailVerifiedAt: verified ? new Date("2026-01-01") : null,
  });
  return id;
}
function command(memberId: string) {
  return {
    memberId,
    action: "GRANT" as const,
    rationale: "Owner-authorized upload-only access",
    actor: "test-host-admin",
  };
}
function gate(mode: "OFF" | "PILOT" = "PILOT") {
  return createIssueMediaUploadGateService(database.db, {
    mode,
    consentVersion: "which-media-consent-v2",
    pseudonymSecret: "upload-only-test-secret",
  });
}

describe("host-admin upload-only capability", () => {
  it("dry runs without a grant and rejects a different confirmation target", async () => {
    const id = await member();
    await expect(decideUploadOnlyAccess(database.db, command(id))).resolves.toMatchObject({
      mode: "DRY_RUN",
      changed: false,
    });
    await expect(
      decideUploadOnlyAccess(database.db, { ...command(id), confirmMemberId: randomUUID() }),
    ).rejects.toThrow("Confirmation");
    expect(
      await database.db
        .select()
        .from(memberCapabilityGrants)
        .where(eq(memberCapabilityGrants.memberId, id)),
    ).toHaveLength(0);
  });

  it("grants only the named account, preserves consent and limits, audits atomically, and can revoke", async () => {
    const id = await member();
    const other = await member();
    const args = { ...command(id), confirmMemberId: id };
    const result = await decideUploadOnlyAccess(database.db, args);
    expect(result).toMatchObject({
      changed: true,
      consentChanged: false,
      publicationChanged: false,
      policyVersion: UPLOAD_ONLY_POLICY_VERSION,
    });
    await expect(gate().readAccess(id)).resolves.toMatchObject({
      allowed: false,
      reasons: ["CONSENT_REQUIRED"],
    });
    await expect(gate().readAccess(other)).resolves.toMatchObject({
      allowed: false,
      reasons: ["CAPABILITY_REQUIRED", "CONSENT_REQUIRED"],
    });
    expect(
      await database.db
        .select()
        .from(memberMediaConsents)
        .where(eq(memberMediaConsents.memberId, id)),
    ).toHaveLength(0);
    await expect(decideUploadOnlyAccess(database.db, args)).resolves.toMatchObject({
      changed: false,
    });
    const [grant] = await database.db
      .select()
      .from(memberCapabilityGrants)
      .where(eq(memberCapabilityGrants.memberId, id));
    expect(grant!.expiresAt.getTime() - grant!.grantedAt.getTime()).toBe(30 * 86_400_000);
    expect(
      await database.db
        .select()
        .from(memberCapabilityEvents)
        .where(eq(memberCapabilityEvents.grantId, grant!.id)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(operatorAuditLogs).where(eq(operatorAuditLogs.memberId, id)),
    ).toHaveLength(1);

    const submissionId = randomUUID();
    await database.db.insert(memberIssueSubmissions).values({
      id: submissionId,
      memberId: id,
      idempotencyKey: randomUUID(),
      status: "PENDING",
      question: "어느 이미지가 더 좋나요?",
      choiceA: "첫 번째",
      choiceB: "두 번째",
      interestCardCode: "DAILY_LIFE",
      contentHash: "a".repeat(64),
    });
    const sessionInput = {
      memberId: id,
      submissionId,
      consentVersion: "which-media-consent-v2",
      ipAddress: "203.0.113.9",
    };
    await expect(gate().createSession(sessionInput)).rejects.toMatchObject({
      reasons: ["CONSENT_REQUIRED"],
    });
    // A simulated user's own consent, never performed by the admin grant command.
    await gate().acceptConsent(id);
    await expect(gate("OFF").createSession(sessionInput)).rejects.toMatchObject({
      reasons: ["MODE_DISABLED"],
    });
    await expect(gate().createSession({ ...sessionInput, memberId: other })).rejects.toMatchObject({
      reasons: ["CAPABILITY_REQUIRED", "CONSENT_REQUIRED", "SUBMISSION_OWNERSHIP_REQUIRED"],
    });
    const session = await gate().createSession(sessionInput);
    expect(session.maxBytes).toBe(10 * 1024 * 1024);
    const secondSession = await gate().createSession(sessionInput);
    await expect(gate().createSession(sessionInput)).rejects.toMatchObject({
      reasons: ["CONCURRENT_SESSION_LIMIT"],
    });
    await gate().consumeSession({
      memberId: id,
      sessionId: session.id,
      token: session.token,
      byteSize: 1024,
    });
    await gate().consumeSession({
      memberId: id,
      sessionId: secondSession.id,
      token: secondSession.token,
      byteSize: 1024,
    });
    await decideUploadOnlyAccess(database.db, { ...args, action: "REVOKE" });
    await expect(gate().createSession(sessionInput)).rejects.toMatchObject({
      reasons: ["CAPABILITY_REQUIRED"],
    });
    expect(
      await database.db
        .select()
        .from(memberCapabilityEvents)
        .where(eq(memberCapabilityEvents.grantId, grant!.id)),
    ).toHaveLength(2);
  });

  it("does not grant access to unverified/restricted members or overwrite another policy", async () => {
    const id = await member(false);
    await expect(
      decideUploadOnlyAccess(database.db, { ...command(id), confirmMemberId: id }),
    ).rejects.toThrow("verified email");
    const restricted = await member();
    await database.db
      .update(members)
      .set({ status: "SUSPENDED" })
      .where(eq(members.id, restricted));
    await expect(
      decideUploadOnlyAccess(database.db, { ...command(restricted), confirmMemberId: restricted }),
    ).rejects.toThrow("active Member");
    const trusted = await member();
    await database.db.insert(memberCapabilityGrants).values({
      memberId: trusted,
      capabilityCode: "ISSUE_IMAGE_UPLOAD",
      policyVersion: "which-trusted-image-uploader-v1",
      reason: "Existing normal trusted Pilot grant",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(
      decideUploadOnlyAccess(database.db, { ...command(trusted), confirmMemberId: trusted }),
    ).rejects.toThrow("existing Pilot workflow");
  });

  it.each(["REVOKED", "CONSENT", "OFF", "SUSPENDED", "EXPIRED"])(
    "rejects an already issued session after %s without consuming it",
    async (change) => {
      const id = await member();
      await decideUploadOnlyAccess(database.db, { ...command(id), confirmMemberId: id });
      await gate().acceptConsent(id);
      const submissionId = randomUUID();
      await database.db.insert(memberIssueSubmissions).values({
        id: submissionId,
        memberId: id,
        idempotencyKey: randomUUID(),
        status: "PENDING",
        question: "어떤 색상이 더 좋나요?",
        choiceA: "파랑",
        choiceB: "노랑",
        interestCardCode: "DAILY_LIFE",
        contentHash: "b".repeat(64),
      });
      const session = await gate().createSession({
        memberId: id,
        submissionId,
        consentVersion: "which-media-consent-v2",
        ipAddress: "203.0.113.10",
      });
      if (change === "REVOKED") {
        await decideUploadOnlyAccess(database.db, {
          ...command(id),
          action: "REVOKE",
          confirmMemberId: id,
        });
      } else if (change === "CONSENT") {
        await database.db
          .update(memberMediaConsents)
          .set({ revokedAt: new Date(Date.now() + 1000) })
          .where(eq(memberMediaConsents.memberId, id));
      } else if (change === "SUSPENDED") {
        await database.db.update(members).set({ status: "SUSPENDED" }).where(eq(members.id, id));
      } else if (change === "EXPIRED") {
        await database.db
          .update(memberCapabilityGrants)
          .set({ grantedAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) })
          .where(eq(memberCapabilityGrants.memberId, id));
      }
      await expect(
        gate(change === "OFF" ? "OFF" : "PILOT").consumeSession({
          memberId: id,
          sessionId: session.id,
          token: session.token,
          byteSize: 1024,
        }),
      ).rejects.toMatchObject({ code: "MEDIA_UPLOAD_SESSION_INVALID" });
    },
  );
});
