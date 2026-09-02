import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  pointAccounts,
  votes,
} from "../../database/schema/index.js";

import { createPointLedgerService } from "./service.js";

export const POINT_INTEGRITY_POLICY_VERSION = "w_point_integrity_v1";

export type PointAccountMismatch = {
  memberId: string;
  actual: {
    cachedBalance: number;
    restrictedDebt: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
  };
  expected: {
    cachedBalance: number;
    restrictedDebt: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
  };
};

export type PointReconciliationReport = {
  schemaVersion: 1;
  kind: "POINT_RECONCILIATION";
  targetEnvironment: string;
  generatedAt: string;
  memberId: string | null;
  summary: { accounts: number; consistent: number; mismatched: number; repairCount: number };
  mismatches: PointAccountMismatch[];
  digest: string;
  confirmationToken: string;
};

export type PointReversalCandidate = {
  originalEntryId: string;
  memberId: string;
  voteId: string;
  amount: number;
  operationDay: string;
  integrityState: string;
};

export type PointReversalReport = {
  schemaVersion: 1;
  kind: "POINT_INVALIDATED_VOTE_REVERSAL";
  targetEnvironment: string;
  generatedAt: string;
  summary: { candidates: number; pointsToReverse: number };
  candidates: PointReversalCandidate[];
  digest: string;
  confirmationToken: string;
};

export class PointIntegrityError extends Error {
  constructor(
    public readonly code:
      | "OPERATOR_ROLE_REQUIRED"
      | "INVALID_CONFIRMATION_TOKEN"
      | "STALE_RECONCILIATION_REPORT"
      | "STALE_REVERSAL_REPORT"
      | "INVALID_ADJUSTMENT",
    message: string,
  ) {
    super(message);
    this.name = "PointIntegrityError";
  }
}

function numberValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function confirmationToken(kind: string, targetEnvironment: string, reportDigest: string) {
  return `${targetEnvironment}:${kind}:${reportDigest}`;
}

function reconciliationDigest(input: {
  targetEnvironment: string;
  memberId: string | null;
  mismatches: PointAccountMismatch[];
}) {
  return digest({
    schemaVersion: 1,
    kind: "POINT_RECONCILIATION",
    targetEnvironment: input.targetEnvironment,
    memberId: input.memberId,
    mismatches: input.mismatches,
  });
}

function reversalDigest(input: {
  targetEnvironment: string;
  candidates: PointReversalCandidate[];
}) {
  return digest({
    schemaVersion: 1,
    kind: "POINT_INVALIDATED_VOTE_REVERSAL",
    targetEnvironment: input.targetEnvironment,
    candidates: input.candidates,
  });
}

type OperatorInput = { operatorMemberId: string; requestId?: string };

export function createPointIntegrityService(
  database: Database["db"],
  options: { targetEnvironment: string },
) {
  const ledger = createPointLedgerService(database);

  async function audit(input: {
    memberId: string;
    eventType: string;
    outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await database.insert(operatorAuditLogs).values({
      memberId: input.memberId,
      eventType: input.eventType,
      outcome: input.outcome,
      requestId: input.requestId,
      metadata: input.metadata ?? {},
    });
  }

  async function requireOperator(input: OperatorInput, eventType: string) {
    const [operator] = await database
      .select({ memberId: members.id, displayName: members.displayName })
      .from(operatorAccessGrants)
      .innerJoin(members, eq(members.id, operatorAccessGrants.memberId))
      .where(
        and(
          eq(operatorAccessGrants.memberId, input.operatorMemberId),
          eq(operatorAccessGrants.role, "OPERATOR"),
          isNull(operatorAccessGrants.revokedAt),
          eq(members.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!operator) {
      await audit({
        memberId: input.operatorMemberId,
        eventType,
        outcome: "DENIED",
        requestId: input.requestId,
        metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
      });
      throw new PointIntegrityError(
        "OPERATOR_ROLE_REQUIRED",
        "An active WHICH OPERATOR grant is required.",
      );
    }
    return operator;
  }

  async function buildReconciliation(memberId: string | null): Promise<PointReconciliationReport> {
    const memberClause = memberId ? sql`where pa.member_id = ${memberId}::uuid` : sql``;
    const result = await database.execute<{
      member_id: string;
      cached_balance: number;
      restricted_debt: number;
      lifetime_earned: number;
      lifetime_spent: number;
      expected_net: number;
      expected_lifetime_earned: number;
      expected_lifetime_spent: number;
    }>(sql`
      select pa.member_id,
        pa.cached_balance,
        pa.restricted_debt,
        pa.lifetime_earned,
        pa.lifetime_spent,
        coalesce(sum(ple.amount), 0)::int as expected_net,
        coalesce(sum(case when ple.entry_type = 'EARN' then ple.amount else 0 end), 0)::int
          as expected_lifetime_earned,
        coalesce(sum(case when ple.entry_type = 'SPEND' then -ple.amount else 0 end), 0)::int
          as expected_lifetime_spent
      from point_accounts pa
      left join point_ledger_entries ple on ple.member_id = pa.member_id
      ${memberClause}
      group by pa.member_id, pa.cached_balance, pa.restricted_debt,
        pa.lifetime_earned, pa.lifetime_spent
      order by pa.member_id
    `);
    const mismatches: PointAccountMismatch[] = [];
    for (const row of result.rows) {
      const net = numberValue(row.expected_net);
      const actual = {
        cachedBalance: numberValue(row.cached_balance),
        restrictedDebt: numberValue(row.restricted_debt),
        lifetimeEarned: numberValue(row.lifetime_earned),
        lifetimeSpent: numberValue(row.lifetime_spent),
      };
      const expected = {
        cachedBalance: Math.max(net, 0),
        restrictedDebt: Math.max(-net, 0),
        lifetimeEarned: numberValue(row.expected_lifetime_earned),
        lifetimeSpent: numberValue(row.expected_lifetime_spent),
      };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push({ memberId: row.member_id, actual, expected });
      }
    }
    const reportDigest = reconciliationDigest({
      targetEnvironment: options.targetEnvironment,
      memberId,
      mismatches,
    });
    return {
      schemaVersion: 1,
      kind: "POINT_RECONCILIATION",
      targetEnvironment: options.targetEnvironment,
      generatedAt: new Date().toISOString(),
      memberId,
      summary: {
        accounts: result.rows.length,
        consistent: result.rows.length - mismatches.length,
        mismatched: mismatches.length,
        repairCount: mismatches.length,
      },
      mismatches,
      digest: reportDigest,
      confirmationToken: confirmationToken("point-repair", options.targetEnvironment, reportDigest),
    };
  }

  async function buildReversalReport(): Promise<PointReversalReport> {
    const result = await database.execute<{
      original_entry_id: string;
      member_id: string;
      vote_id: string;
      amount: number;
      operation_day: string;
      integrity_state: string;
    }>(sql`
      select ple.point_ledger_entry_id as original_entry_id,
        ple.member_id,
        ple.source_id as vote_id,
        ple.amount,
        ple.operation_day,
        v.integrity_state::text as integrity_state
      from point_ledger_entries ple
      join votes v on v.vote_id::text = ple.source_id
      left join point_ledger_entries reversal
        on reversal.reverses_entry_id = ple.point_ledger_entry_id
      where ple.entry_type = 'EARN'
        and ple.source_type = 'VOTE'
        and ple.reason_code = 'VOTE_ACCEPTED'
        and v.integrity_state in ('INVALIDATED', 'REJECTED_ABUSE')
        and reversal.point_ledger_entry_id is null
      order by ple.point_ledger_entry_id
    `);
    const candidates = result.rows.map((row) => ({
      originalEntryId: row.original_entry_id,
      memberId: row.member_id,
      voteId: row.vote_id,
      amount: numberValue(row.amount),
      operationDay: row.operation_day,
      integrityState: row.integrity_state,
    }));
    const reportDigest = reversalDigest({
      targetEnvironment: options.targetEnvironment,
      candidates,
    });
    return {
      schemaVersion: 1,
      kind: "POINT_INVALIDATED_VOTE_REVERSAL",
      targetEnvironment: options.targetEnvironment,
      generatedAt: new Date().toISOString(),
      summary: {
        candidates: candidates.length,
        pointsToReverse: candidates.reduce((sum, candidate) => sum + candidate.amount, 0),
      },
      candidates,
      digest: reportDigest,
      confirmationToken: confirmationToken(
        "point-reversal",
        options.targetEnvironment,
        reportDigest,
      ),
    };
  }

  return {
    async reconcile(input: OperatorInput & { memberId?: string }) {
      await requireOperator(input, "OPS_POINT_RECONCILIATION_READ");
      const report = await buildReconciliation(input.memberId ?? null);
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_RECONCILIATION_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { mismatched: report.summary.mismatched, memberId: input.memberId ?? null },
      });
      return report;
    },

    async repair(input: OperatorInput & { report: PointReconciliationReport; confirm: string }) {
      await requireOperator(input, "OPS_POINT_REPAIR");
      const suppliedDigest = reconciliationDigest({
        targetEnvironment: options.targetEnvironment,
        memberId: input.report.memberId,
        mismatches: input.report.mismatches,
      });
      if (input.report.digest !== suppliedDigest) {
        await audit({
          memberId: input.operatorMemberId,
          eventType: "OPS_POINT_REPAIR",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "REPORT_DIGEST_MISMATCH" },
        });
        throw new PointIntegrityError(
          "STALE_RECONCILIATION_REPORT",
          "The point reconciliation artifact digest is invalid.",
        );
      }
      const expectedToken = confirmationToken(
        "point-repair",
        options.targetEnvironment,
        input.report.digest,
      );
      if (input.confirm !== expectedToken) {
        await audit({
          memberId: input.operatorMemberId,
          eventType: "OPS_POINT_REPAIR",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "INVALID_CONFIRMATION_TOKEN", digest: input.report.digest },
        });
        throw new PointIntegrityError(
          "INVALID_CONFIRMATION_TOKEN",
          "The explicit point repair confirmation token does not match the report.",
        );
      }
      const repaired = await database.transaction(async (transaction) => {
        let count = 0;
        for (const mismatch of input.report.mismatches) {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`point-account:${mismatch.memberId}`}, 0))`,
          );
          const [current] = await transaction
            .select({
              cachedBalance: pointAccounts.cachedBalance,
              restrictedDebt: pointAccounts.restrictedDebt,
              lifetimeEarned: pointAccounts.lifetimeEarned,
              lifetimeSpent: pointAccounts.lifetimeSpent,
            })
            .from(pointAccounts)
            .where(eq(pointAccounts.memberId, mismatch.memberId))
            .limit(1);
          if (!current) {
            throw new PointIntegrityError(
              "STALE_RECONCILIATION_REPORT",
              `Point account ${mismatch.memberId} no longer exists.`,
            );
          }
          if (JSON.stringify(current) === JSON.stringify(mismatch.expected)) continue;
          if (JSON.stringify(current) !== JSON.stringify(mismatch.actual)) {
            throw new PointIntegrityError(
              "STALE_RECONCILIATION_REPORT",
              `Point account ${mismatch.memberId} changed after the Dry Run.`,
            );
          }
          await transaction
            .update(pointAccounts)
            .set({
              ...mismatch.expected,
              version: sql`${pointAccounts.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(pointAccounts.memberId, mismatch.memberId));
          count += 1;
        }
        return count;
      });
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_REPAIR",
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { digest: input.report.digest, repaired },
      });
      return { repaired, alreadyConsistent: input.report.mismatches.length - repaired };
    },

    async planInvalidatedVoteReversals(input: OperatorInput) {
      await requireOperator(input, "OPS_POINT_REVERSAL_READ");
      const report = await buildReversalReport();
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_REVERSAL_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: report.summary,
      });
      return report;
    },

    async applyInvalidatedVoteReversals(
      input: OperatorInput & { report: PointReversalReport; confirm: string },
    ) {
      await requireOperator(input, "OPS_POINT_REVERSAL_APPLY");
      const suppliedDigest = reversalDigest({
        targetEnvironment: options.targetEnvironment,
        candidates: input.report.candidates,
      });
      if (input.report.digest !== suppliedDigest) {
        throw new PointIntegrityError(
          "STALE_REVERSAL_REPORT",
          "The point reversal artifact digest is invalid.",
        );
      }
      const expectedToken = confirmationToken(
        "point-reversal",
        options.targetEnvironment,
        input.report.digest,
      );
      if (input.confirm !== expectedToken) {
        throw new PointIntegrityError(
          "INVALID_CONFIRMATION_TOKEN",
          "The explicit reversal confirmation token does not match the report.",
        );
      }
      let applied = 0;
      let alreadyApplied = 0;
      for (const candidate of input.report.candidates) {
        const [currentVote] = await database
          .select({ integrityState: votes.integrityState })
          .from(votes)
          .where(eq(votes.id, candidate.voteId))
          .limit(1);
        if (
          !currentVote ||
          !["INVALIDATED", "REJECTED_ABUSE"].includes(currentVote.integrityState)
        ) {
          throw new PointIntegrityError(
            "STALE_REVERSAL_REPORT",
            `Vote ${candidate.voteId} is no longer eligible for reversal.`,
          );
        }
        const result = await ledger.applyEntry({
          memberId: candidate.memberId,
          entryType: "REVERSAL",
          amount: -candidate.amount,
          reasonCode: "INVALIDATED_ACTIVITY_REVERSAL",
          sourceType: "VOTE_REVERSAL",
          sourceId: candidate.voteId,
          operationDay: candidate.operationDay,
          reversesEntryId: candidate.originalEntryId,
          idempotencyKey: `point-reversal:${candidate.originalEntryId}`,
          policyVersion: POINT_INTEGRITY_POLICY_VERSION,
          metadata: {
            operatorMemberId: input.operatorMemberId,
            originalIntegrityState: candidate.integrityState,
          },
        });
        if (result.applied) applied += 1;
        else alreadyApplied += 1;
      }
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_REVERSAL_APPLY",
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { digest: input.report.digest, applied, alreadyApplied },
      });
      return { applied, alreadyApplied };
    },

    async adjust(
      input: OperatorInput & {
        targetMemberId: string;
        amount: number;
        reason: string;
        incidentId: string;
        idempotencyKey: string;
      },
    ) {
      const operator = await requireOperator(input, "OPS_POINT_ADJUSTMENT");
      if (
        !Number.isSafeInteger(input.amount) ||
        input.amount === 0 ||
        !input.reason.trim() ||
        input.incidentId.trim().length < 3 ||
        input.idempotencyKey.trim().length < 8
      ) {
        await audit({
          memberId: input.operatorMemberId,
          eventType: "OPS_POINT_ADJUSTMENT",
          outcome: "DENIED",
          requestId: input.requestId,
          metadata: { reason: "INVALID_ADJUSTMENT", targetMemberId: input.targetMemberId },
        });
        throw new PointIntegrityError(
          "INVALID_ADJUSTMENT",
          "Adjustment amount, reason, Incident ID, and idempotency key are required.",
        );
      }
      const result = await ledger.applyEntry({
        memberId: input.targetMemberId,
        entryType: "ADJUSTMENT",
        amount: input.amount,
        reasonCode: "OPERATOR_ADJUSTMENT",
        sourceType: "OPS_ADJUSTMENT",
        sourceId: `${input.incidentId}:${input.targetMemberId}`,
        operationDay: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        idempotencyKey: input.idempotencyKey,
        policyVersion: POINT_INTEGRITY_POLICY_VERSION,
        metadata: {
          operatorMemberId: operator.memberId,
          operatorDisplayName: operator.displayName,
          reason: input.reason.trim(),
          incidentId: input.incidentId.trim(),
        },
      });
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_ADJUSTMENT",
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: {
          targetMemberId: input.targetMemberId,
          amount: input.amount,
          incidentId: input.incidentId,
          ledgerEntryId: result.entryId,
          applied: result.applied,
        },
      });
      return result;
    },

    async listLedger(
      input: OperatorInput & {
        memberId?: string;
        sourceEventId?: string;
        sourceType?: string;
        from?: string;
        to?: string;
        limit?: number;
      },
    ) {
      await requireOperator(input, "OPS_POINT_LEDGER_READ");
      const memberClause = input.memberId
        ? sql`and ple.member_id = ${input.memberId}::uuid`
        : sql``;
      const eventClause = input.sourceEventId
        ? sql`and per.event_id = ${input.sourceEventId}::uuid`
        : sql``;
      const sourceClause = input.sourceType
        ? sql`and ple.source_type = ${input.sourceType}`
        : sql``;
      const fromClause = input.from ? sql`and ple.created_at >= ${input.from}::timestamptz` : sql``;
      const toClause = input.to ? sql`and ple.created_at < ${input.to}::timestamptz` : sql``;
      const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
      const result = await database.execute<{
        point_ledger_entry_id: string;
        member_id: string;
        entry_type: string;
        amount: number;
        reason_code: string;
        source_type: string;
        source_id: string;
        source_event_id: string | null;
        operation_day: string;
        reverses_entry_id: string | null;
        policy_version: string;
        created_at: Date | string;
      }>(sql`
        select ple.point_ledger_entry_id, ple.member_id, ple.entry_type::text as entry_type,
          ple.amount, ple.reason_code, ple.source_type, ple.source_id,
          per.event_id::text as source_event_id, ple.operation_day, ple.reverses_entry_id,
          ple.policy_version, ple.created_at
        from point_ledger_entries ple
        left join point_event_receipts per on per.ledger_entry_id = ple.point_ledger_entry_id
        where true ${memberClause} ${eventClause} ${sourceClause} ${fromClause} ${toClause}
        order by ple.created_at desc, ple.point_ledger_entry_id desc
        limit ${limit}
      `);
      const items = result.rows.map((row) => ({
        entryId: row.point_ledger_entry_id,
        memberId: row.member_id,
        entryType: row.entry_type,
        amount: numberValue(row.amount),
        reasonCode: row.reason_code,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceEventId: row.source_event_id,
        operationDay: row.operation_day,
        reversesEntryId: row.reverses_entry_id,
        policyVersion: row.policy_version,
        createdAt: new Date(row.created_at).toISOString(),
      }));
      const totals = items.reduce(
        (current, item) => {
          current.net += item.amount;
          if (item.entryType === "EARN") current.earned += item.amount;
          if (item.entryType === "SPEND") current.spent += -item.amount;
          if (item.entryType === "REVERSAL") current.reversed += -item.amount;
          if (item.entryType === "ADJUSTMENT") current.adjusted += item.amount;
          return current;
        },
        { earned: 0, spent: 0, reversed: 0, adjusted: 0, net: 0 },
      );
      await audit({
        memberId: input.operatorMemberId,
        eventType: "OPS_POINT_LEDGER_READ",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { resultCount: items.length, filteredMemberId: input.memberId ?? null },
      });
      return { schemaVersion: 1 as const, generatedAt: new Date().toISOString(), totals, items };
    },
  };
}

export type PointIntegrityService = ReturnType<typeof createPointIntegrityService>;
