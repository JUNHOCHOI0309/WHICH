import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  issueChoices,
  issues,
  issueVersions,
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  outboxEvents,
  pointAccounts,
  pointLedgerEntries,
  pointEventReceipts,
  voterSubjects,
  voteAttempts,
  votes,
} from "../src/database/schema/index.js";
import {
  createPointIntegrityService,
  PointIntegrityError,
} from "../src/modules/points/integrity.js";
import { createPointLedgerService } from "../src/modules/points/service.js";
import { createPointPolicyConsumer } from "../src/modules/points/policy.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("W Point integrity and operations", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function createMember(operator = false) {
    const id = randomUUID();
    await testDatabase.database.db.insert(members).values({ id, displayName: `Member ${id}` });
    if (operator) {
      await testDatabase.database.db.insert(operatorAccessGrants).values({
        memberId: id,
        grantedBy: "point-integrity-test",
      });
    }
    return id;
  }

  function earn(memberId: string, sourceId = randomUUID()) {
    return {
      memberId,
      entryType: "EARN" as const,
      amount: 10,
      reasonCode: "VOTE_ACCEPTED",
      sourceType: "VOTE",
      sourceId,
      operationDay: "2026-08-26",
      idempotencyKey: `vote:${sourceId}:point-integrity-test`,
      policyVersion: "w_point_v1",
      counterKey: "ACCEPTED_VOTE",
    };
  }

  async function createAcceptedVote(memberId: string) {
    const issueId = randomUUID();
    const choiceId = randomUUID();
    const secondChoiceId = randomUUID();
    const subjectId = randomUUID();
    const attemptId = randomUUID();
    const voteId = randomUUID();
    await testDatabase.database.db.insert(issues).values({ id: issueId });
    await testDatabase.database.db.insert(issueVersions).values({
      issueId,
      version: 1,
      question: "Point reversal issue?",
      contentHash: "9".repeat(64),
      primaryCategoryCode: "TEST",
      experienceModeCode: "BINARY",
      taxonomyVersion: "v1",
      publishedAt: new Date(),
    });
    await testDatabase.database.db.insert(issueChoices).values([
      { id: choiceId, issueId, issueVersion: 1, code: "A", label: "A" },
      { id: secondChoiceId, issueId, issueVersion: 1, code: "B", label: "B" },
    ]);
    await testDatabase.database.db.insert(voterSubjects).values({
      id: subjectId,
      kind: "MEMBER",
      userId: memberId,
    });
    await testDatabase.database.db.insert(voteAttempts).values({
      id: attemptId,
      idempotencyKey: attemptId,
      issueId,
      issueVersion: 1,
      choiceId,
      subjectId,
      requestState: "COMPLETED",
      requestFingerprint: "f".repeat(64),
      completedAt: new Date(),
    });
    await testDatabase.database.db.insert(votes).values({
      id: voteId,
      voteAttemptId: attemptId,
      issueId,
      issueVersion: 1,
      choiceId,
      subjectId,
      integrityState: "ACCEPTED",
      reasonCode: "TEST",
      userTier: "MEMBER",
      accountAssurance: "AUTHENTICATED",
      uniquenessAssurance: "MEMBER",
      issueRiskLevel: "LOW",
      eligibilityPolicyVersion: "test-v1",
      integrityPolicyVersion: "test-v1",
      acceptedAt: new Date(),
    });
    return voteId;
  }

  it("uses restricted debt for forced reversals and offsets future earnings first", async () => {
    const memberId = await createMember();
    const ledger = createPointLedgerService(testDatabase.database.db);
    const original = await ledger.applyEntry(earn(memberId));
    const purchaseId = randomUUID();
    await ledger.applyEntry({
      memberId,
      entryType: "SPEND",
      amount: -10,
      reasonCode: "CATALOG_PURCHASE",
      sourceType: "POINT_PURCHASE",
      sourceId: purchaseId,
      operationDay: "2026-08-26",
      idempotencyKey: `purchase:${purchaseId}`,
      policyVersion: "w_point_v1",
    });

    const reversed = await ledger.applyEntry({
      memberId,
      entryType: "REVERSAL",
      amount: -10,
      reasonCode: "INVALIDATED_ACTIVITY_REVERSAL",
      sourceType: "VOTE_REVERSAL",
      sourceId: "invalidated-vote",
      operationDay: "2026-08-26",
      reversesEntryId: original.entryId,
      idempotencyKey: `reversal:${original.entryId}`,
      policyVersion: "w_point_integrity_v1",
    });
    expect(reversed.account).toMatchObject({ cachedBalance: 0, restrictedDebt: 10 });

    const offset = await ledger.applyEntry(earn(memberId));
    expect(offset.account).toMatchObject({ cachedBalance: 0, restrictedDebt: 0 });
  });

  it("repairs cached account projections and is idempotent when rerun", async () => {
    const operatorMemberId = await createMember(true);
    const memberId = await createMember();
    await createPointLedgerService(testDatabase.database.db).applyEntry(earn(memberId));
    await testDatabase.database.db
      .update(pointAccounts)
      .set({ cachedBalance: 7 })
      .where(eq(pointAccounts.memberId, memberId));
    const integrity = createPointIntegrityService(testDatabase.database.db, {
      targetEnvironment: "test",
    });

    const report = await integrity.reconcile({ operatorMemberId, memberId });
    expect(report.summary).toMatchObject({ accounts: 1, mismatched: 1, repairCount: 1 });
    expect(report.mismatches[0]).toMatchObject({
      memberId,
      actual: { cachedBalance: 7 },
      expected: { cachedBalance: 10, restrictedDebt: 0 },
    });

    expect(
      await integrity.repair({
        operatorMemberId,
        report,
        confirm: report.confirmationToken,
      }),
    ).toEqual({ repaired: 1, alreadyConsistent: 0 });
    expect(
      await integrity.repair({
        operatorMemberId,
        report,
        confirm: report.confirmationToken,
      }),
    ).toEqual({ repaired: 0, alreadyConsistent: 1 });
  });

  it("reverses an invalidated Vote once and keeps the account projection consistent", async () => {
    const operatorMemberId = await createMember(true);
    const memberId = await createMember();
    const voteId = await createAcceptedVote(memberId);
    await createPointLedgerService(testDatabase.database.db).applyEntry(earn(memberId, voteId));
    await testDatabase.database.db
      .update(votes)
      .set({ integrityState: "INVALIDATED", invalidatedAt: new Date() })
      .where(eq(votes.id, voteId));
    const integrity = createPointIntegrityService(testDatabase.database.db, {
      targetEnvironment: "test",
    });

    const report = await integrity.planInvalidatedVoteReversals({ operatorMemberId });
    expect(report.summary).toEqual({ candidates: 1, pointsToReverse: 10 });
    expect(
      await integrity.applyInvalidatedVoteReversals({
        operatorMemberId,
        report,
        confirm: report.confirmationToken,
      }),
    ).toEqual({ applied: 1, alreadyApplied: 0 });
    expect(
      await integrity.applyInvalidatedVoteReversals({
        operatorMemberId,
        report,
        confirm: report.confirmationToken,
      }),
    ).toEqual({ applied: 0, alreadyApplied: 1 });

    const [account] = await testDatabase.database.db
      .select()
      .from(pointAccounts)
      .where(eq(pointAccounts.memberId, memberId));
    expect(account).toMatchObject({ cachedBalance: 0, restrictedDebt: 0, lifetimeEarned: 10 });
    const entries = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    expect(entries).toHaveLength(2);
  });

  it("automatically consumes VOTE_INVALIDATED even when new earning is feature-disabled", async () => {
    const memberId = await createMember();
    const voteId = await createAcceptedVote(memberId);
    await createPointLedgerService(testDatabase.database.db).applyEntry(earn(memberId, voteId));
    await testDatabase.database.db
      .update(votes)
      .set({ integrityState: "INVALIDATED", invalidatedAt: new Date() })
      .where(eq(votes.id, voteId));
    const eventId = randomUUID();
    await testDatabase.database.db.insert(outboxEvents).values({
      id: eventId,
      eventType: "VOTE_INVALIDATED",
      aggregateType: "VOTE",
      aggregateId: voteId,
      schemaVersion: 1,
      occurredAt: new Date(),
      payload: { data: { vote_id: voteId } },
    });
    const [event] = await testDatabase.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));

    const consumer = createPointPolicyConsumer(testDatabase.database.db, { enabled: false });
    expect(await consumer.processEvent(event!)).toBe("REVERSED");
    const [receipt] = await testDatabase.database.db
      .select()
      .from(pointEventReceipts)
      .where(eq(pointEventReceipts.eventId, eventId));
    expect(receipt).toMatchObject({ outcome: "REVERSED" });
  });

  it("requires an active OPERATOR and writes a denial audit event", async () => {
    const memberId = await createMember();
    const integrity = createPointIntegrityService(testDatabase.database.db, {
      targetEnvironment: "test",
    });

    await expect(integrity.reconcile({ operatorMemberId: memberId })).rejects.toBeInstanceOf(
      PointIntegrityError,
    );
    const [audit] = await testDatabase.database.db
      .select()
      .from(operatorAuditLogs)
      .where(eq(operatorAuditLogs.memberId, memberId));
    expect(audit).toMatchObject({
      eventType: "OPS_POINT_RECONCILIATION_READ",
      outcome: "DENIED",
    });
  });

  it("requires incident metadata for adjustments and stores it only in the private ledger", async () => {
    const operatorMemberId = await createMember(true);
    const targetMemberId = await createMember();
    const integrity = createPointIntegrityService(testDatabase.database.db, {
      targetEnvironment: "test",
    });

    await expect(
      integrity.adjust({
        operatorMemberId,
        targetMemberId,
        amount: 20,
        reason: "short",
        incidentId: "",
        idempotencyKey: "adjustment-test",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ADJUSTMENT" });

    const adjusted = await integrity.adjust({
      operatorMemberId,
      targetMemberId,
      amount: 20,
      reason: "Confirmed manual recovery adjustment",
      incidentId: "INC-114",
      idempotencyKey: "adjustment:INC-114:target",
    });
    expect(adjusted.account).toMatchObject({ cachedBalance: 20, restrictedDebt: 0 });
    const [entry] = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.id, adjusted.entryId));
    expect(entry?.metadata).toMatchObject({
      operatorMemberId,
      incidentId: "INC-114",
      reason: "Confirmed manual recovery adjustment",
    });
  });
});
