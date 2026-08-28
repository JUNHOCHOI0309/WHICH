import { and, asc, eq, lte, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  members,
  memberPointBadgeAwards,
  outboxEvents,
  pointAccounts,
  pointBadgePolicies,
  pointDailyCounters,
  pointLedgerEntries,
} from "../../database/schema/index.js";
import { POINT_BADGE_POLICY_VERSION } from "./badge-policy.js";

export type PointLedgerEntryType = "EARN" | "SPEND" | "REFUND" | "REVERSAL" | "ADJUSTMENT";

export type ApplyPointLedgerEntryCommand = {
  memberId: string;
  entryType: PointLedgerEntryType;
  amount: number;
  reasonCode: string;
  sourceType: string;
  sourceId: string;
  operationDay: string;
  idempotencyKey: string;
  policyVersion: string;
  counterKey?: string;
  dailyQualifyingLimit?: number;
  dailyPointLimit?: number;
  reversesEntryId?: string;
  metadata?: Record<string, unknown>;
};

export type PointLedgerMutationResult = {
  applied: boolean;
  entryId: string;
  account: {
    cachedBalance: number;
    restrictedDebt: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    version: number;
  };
};

export type PointLedgerErrorCode =
  | "INVALID_POINT_ENTRY"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_NOT_ELIGIBLE"
  | "POINT_IDEMPOTENCY_CONFLICT"
  | "POINT_DAILY_LIMIT_REACHED"
  | "INSUFFICIENT_POINT_BALANCE";

export class PointLedgerError extends Error {
  constructor(
    public readonly code: PointLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PointLedgerError";
  }
}

function assertCommand(command: ApplyPointLedgerEntryCommand) {
  if (!Number.isSafeInteger(command.amount) || command.amount === 0) {
    throw new PointLedgerError("INVALID_POINT_ENTRY", "Point amounts must be non-zero integers.");
  }

  const positiveEntry = command.entryType === "EARN" || command.entryType === "REFUND";
  const negativeEntry = command.entryType === "SPEND" || command.entryType === "REVERSAL";
  if ((positiveEntry && command.amount < 0) || (negativeEntry && command.amount > 0)) {
    throw new PointLedgerError(
      "INVALID_POINT_ENTRY",
      "The point amount does not match the ledger entry type.",
    );
  }
  if (command.entryType === "REVERSAL" ? !command.reversesEntryId : command.reversesEntryId) {
    throw new PointLedgerError(
      "INVALID_POINT_ENTRY",
      "Only reversal entries must reference the ledger entry they reverse.",
    );
  }
  if (command.entryType === "EARN" && !command.counterKey) {
    throw new PointLedgerError("INVALID_POINT_ENTRY", "Earn entries require a daily counter key.");
  }
  for (const limit of [command.dailyQualifyingLimit, command.dailyPointLimit]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
      throw new PointLedgerError(
        "INVALID_POINT_ENTRY",
        "Daily point limits must be positive integers.",
      );
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.operationDay)) {
    throw new PointLedgerError(
      "INVALID_POINT_ENTRY",
      "The operation day must use the YYYY-MM-DD format.",
    );
  }
  const requiredValues = [
    command.memberId,
    command.reasonCode,
    command.sourceType,
    command.sourceId,
    command.idempotencyKey,
    command.policyVersion,
  ];
  if (requiredValues.some((value) => value.trim().length === 0)) {
    throw new PointLedgerError("INVALID_POINT_ENTRY", "Point entry identifiers cannot be empty.");
  }
}

function sameLedgerFact(
  row: {
    memberId: string;
    entryType: PointLedgerEntryType;
    amount: number;
    reasonCode: string;
    sourceType: string;
    sourceId: string;
    operationDay: string;
    reversesEntryId: string | null;
    policyVersion: string;
  },
  command: ApplyPointLedgerEntryCommand,
) {
  return (
    row.memberId === command.memberId &&
    row.entryType === command.entryType &&
    row.amount === command.amount &&
    row.reasonCode === command.reasonCode &&
    row.sourceType === command.sourceType &&
    row.sourceId === command.sourceId &&
    row.operationDay === command.operationDay &&
    row.reversesEntryId === (command.reversesEntryId ?? null) &&
    row.policyVersion === command.policyVersion
  );
}

export function createPointLedgerService(database: Database["db"]) {
  return {
    async applyEntry(command: ApplyPointLedgerEntryCommand): Promise<PointLedgerMutationResult> {
      assertCommand(command);

      return database.transaction(async (transaction) => {
        const [member] = await transaction
          .select({ status: members.status })
          .from(members)
          .where(eq(members.id, command.memberId))
          .limit(1);
        if (!member) {
          throw new PointLedgerError("MEMBER_NOT_FOUND", "The point owner was not found.");
        }
        if (member.status !== "ACTIVE") {
          throw new PointLedgerError(
            "MEMBER_NOT_ELIGIBLE",
            "Only active members can own or mutate a point account.",
          );
        }

        await transaction
          .insert(pointAccounts)
          .values({ memberId: command.memberId })
          .onConflictDoNothing({ target: pointAccounts.memberId });

        if (command.entryType === "EARN") {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${command.memberId}:${command.operationDay}:${command.counterKey}`}, 0))`,
          );

          const [existing] = await transaction
            .select({
              id: pointLedgerEntries.id,
              memberId: pointLedgerEntries.memberId,
              entryType: pointLedgerEntries.entryType,
              amount: pointLedgerEntries.amount,
              reasonCode: pointLedgerEntries.reasonCode,
              sourceType: pointLedgerEntries.sourceType,
              sourceId: pointLedgerEntries.sourceId,
              operationDay: pointLedgerEntries.operationDay,
              reversesEntryId: pointLedgerEntries.reversesEntryId,
              policyVersion: pointLedgerEntries.policyVersion,
            })
            .from(pointLedgerEntries)
            .where(
              or(
                eq(pointLedgerEntries.idempotencyKey, command.idempotencyKey),
                and(
                  eq(pointLedgerEntries.sourceType, command.sourceType),
                  eq(pointLedgerEntries.sourceId, command.sourceId),
                  eq(pointLedgerEntries.reasonCode, command.reasonCode),
                ),
              ),
            )
            .limit(1);

          if (existing) {
            if (!sameLedgerFact(existing, command)) {
              throw new PointLedgerError(
                "POINT_IDEMPOTENCY_CONFLICT",
                "The idempotency or source key is already bound to a different point fact.",
              );
            }
            const [account] = await transaction
              .select({
                cachedBalance: pointAccounts.cachedBalance,
                restrictedDebt: pointAccounts.restrictedDebt,
                lifetimeEarned: pointAccounts.lifetimeEarned,
                lifetimeSpent: pointAccounts.lifetimeSpent,
                version: pointAccounts.version,
              })
              .from(pointAccounts)
              .where(eq(pointAccounts.memberId, command.memberId))
              .limit(1);
            return { applied: false, entryId: existing.id, account: account! };
          }

          const [counter] = await transaction
            .select({
              qualifyingCount: pointDailyCounters.qualifyingCount,
              awardedPoints: pointDailyCounters.awardedPoints,
            })
            .from(pointDailyCounters)
            .where(
              and(
                eq(pointDailyCounters.memberId, command.memberId),
                eq(pointDailyCounters.operationDay, command.operationDay),
                eq(pointDailyCounters.counterKey, command.counterKey!),
              ),
            )
            .limit(1);
          if (
            (command.dailyQualifyingLimit !== undefined &&
              (counter?.qualifyingCount ?? 0) >= command.dailyQualifyingLimit) ||
            (command.dailyPointLimit !== undefined &&
              (counter?.awardedPoints ?? 0) + command.amount > command.dailyPointLimit)
          ) {
            throw new PointLedgerError(
              "POINT_DAILY_LIMIT_REACHED",
              "The daily award limit has already been reached.",
            );
          }
        }

        const inserted = await transaction
          .insert(pointLedgerEntries)
          .values({
            memberId: command.memberId,
            entryType: command.entryType,
            amount: command.amount,
            reasonCode: command.reasonCode,
            sourceType: command.sourceType,
            sourceId: command.sourceId,
            operationDay: command.operationDay,
            reversesEntryId: command.reversesEntryId,
            idempotencyKey: command.idempotencyKey,
            policyVersion: command.policyVersion,
            metadata: command.metadata ?? {},
          })
          .onConflictDoNothing()
          .returning({ id: pointLedgerEntries.id });

        if (inserted.length === 0) {
          const existing = await transaction
            .select({
              id: pointLedgerEntries.id,
              memberId: pointLedgerEntries.memberId,
              entryType: pointLedgerEntries.entryType,
              amount: pointLedgerEntries.amount,
              reasonCode: pointLedgerEntries.reasonCode,
              sourceType: pointLedgerEntries.sourceType,
              sourceId: pointLedgerEntries.sourceId,
              operationDay: pointLedgerEntries.operationDay,
              reversesEntryId: pointLedgerEntries.reversesEntryId,
              policyVersion: pointLedgerEntries.policyVersion,
            })
            .from(pointLedgerEntries)
            .where(
              or(
                eq(pointLedgerEntries.idempotencyKey, command.idempotencyKey),
                and(
                  eq(pointLedgerEntries.sourceType, command.sourceType),
                  eq(pointLedgerEntries.sourceId, command.sourceId),
                  eq(pointLedgerEntries.reasonCode, command.reasonCode),
                ),
              ),
            )
            .limit(2);

          if (existing.length !== 1 || !sameLedgerFact(existing[0]!, command)) {
            throw new PointLedgerError(
              "POINT_IDEMPOTENCY_CONFLICT",
              "The idempotency or source key is already bound to a different point fact.",
            );
          }

          const [account] = await transaction
            .select({
              cachedBalance: pointAccounts.cachedBalance,
              restrictedDebt: pointAccounts.restrictedDebt,
              lifetimeEarned: pointAccounts.lifetimeEarned,
              lifetimeSpent: pointAccounts.lifetimeSpent,
              version: pointAccounts.version,
            })
            .from(pointAccounts)
            .where(eq(pointAccounts.memberId, command.memberId))
            .limit(1);

          return { applied: false, entryId: existing[0]!.id, account: account! };
        }

        const earnedIncrement = command.entryType === "EARN" ? command.amount : 0;
        const spentIncrement = command.entryType === "SPEND" ? -command.amount : 0;
        const isForcedNegative =
          command.amount < 0 &&
          (command.entryType === "REVERSAL" || command.entryType === "ADJUSTMENT");
        const isPositive = command.amount > 0;
        const absoluteAmount = Math.abs(command.amount);
        const [account] = await transaction
          .update(pointAccounts)
          .set({
            cachedBalance: isPositive
              ? sql`${pointAccounts.cachedBalance} + greatest(${command.amount} - ${pointAccounts.restrictedDebt}, 0)`
              : isForcedNegative
                ? sql`greatest(${pointAccounts.cachedBalance} + ${command.amount}, 0)`
                : sql`${pointAccounts.cachedBalance} + ${command.amount}`,
            restrictedDebt: isPositive
              ? sql`greatest(${pointAccounts.restrictedDebt} - ${command.amount}, 0)`
              : isForcedNegative
                ? sql`${pointAccounts.restrictedDebt} + greatest(${absoluteAmount} - ${pointAccounts.cachedBalance}, 0)`
                : pointAccounts.restrictedDebt,
            lifetimeEarned: sql`${pointAccounts.lifetimeEarned} + ${earnedIncrement}`,
            lifetimeSpent: sql`${pointAccounts.lifetimeSpent} + ${spentIncrement}`,
            version: sql`${pointAccounts.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pointAccounts.memberId, command.memberId),
              command.entryType === "SPEND"
                ? and(
                    eq(pointAccounts.restrictedDebt, 0),
                    sql`${pointAccounts.cachedBalance} + ${command.amount} >= 0`,
                  )
                : sql`true`,
            ),
          )
          .returning({
            cachedBalance: pointAccounts.cachedBalance,
            restrictedDebt: pointAccounts.restrictedDebt,
            lifetimeEarned: pointAccounts.lifetimeEarned,
            lifetimeSpent: pointAccounts.lifetimeSpent,
            version: pointAccounts.version,
          });

        if (!account) {
          throw new PointLedgerError(
            "INSUFFICIENT_POINT_BALANCE",
            "The point account does not have enough balance for this entry.",
          );
        }

        if (command.entryType === "EARN") {
          await transaction
            .insert(pointDailyCounters)
            .values({
              memberId: command.memberId,
              operationDay: command.operationDay,
              counterKey: command.counterKey!,
              qualifyingCount: 1,
              awardedPoints: command.amount,
            })
            .onConflictDoUpdate({
              target: [
                pointDailyCounters.memberId,
                pointDailyCounters.operationDay,
                pointDailyCounters.counterKey,
              ],
              set: {
                qualifyingCount: sql`${pointDailyCounters.qualifyingCount} + 1`,
                awardedPoints: sql`${pointDailyCounters.awardedPoints} + ${command.amount}`,
                updatedAt: new Date(),
              },
            });

          const eligiblePolicies = await transaction
            .select({
              badgeCode: pointBadgePolicies.badgeCode,
              label: pointBadgePolicies.label,
              minimumLifetimePoints: pointBadgePolicies.minimumLifetimePoints,
              policyVersion: pointBadgePolicies.policyVersion,
            })
            .from(pointBadgePolicies)
            .where(
              and(
                eq(pointBadgePolicies.policyVersion, POINT_BADGE_POLICY_VERSION),
                lte(pointBadgePolicies.minimumLifetimePoints, account.lifetimeEarned),
              ),
            )
            .orderBy(asc(pointBadgePolicies.displayOrder));

          if (eligiblePolicies.length > 0) {
            const awarded = await transaction
              .insert(memberPointBadgeAwards)
              .values(
                eligiblePolicies.map((policy) => ({
                  memberId: command.memberId,
                  badgeCode: policy.badgeCode,
                  policyVersion: policy.policyVersion,
                  thresholdSnapshot: policy.minimumLifetimePoints,
                  labelSnapshot: policy.label,
                  sourceLedgerEntryId: inserted[0]!.id,
                  awardSource: "LEDGER_ENTRY",
                })),
              )
              .onConflictDoNothing({
                target: [memberPointBadgeAwards.memberId, memberPointBadgeAwards.badgeCode],
              })
              .returning({
                id: memberPointBadgeAwards.id,
                badgeCode: memberPointBadgeAwards.badgeCode,
                policyVersion: memberPointBadgeAwards.policyVersion,
                thresholdSnapshot: memberPointBadgeAwards.thresholdSnapshot,
              });

            if (awarded.length > 0) {
              await transaction.insert(outboxEvents).values(
                awarded.map((award) => ({
                  aggregateType: "MEMBER_POINT_BADGE",
                  aggregateId: award.id,
                  eventType: "POINT_BADGE_AWARDED",
                  schemaVersion: 1,
                  payload: {
                    memberId: command.memberId,
                    awardId: award.id,
                    badgeCode: award.badgeCode,
                    policyVersion: award.policyVersion,
                    minimumLifetimePoints: award.thresholdSnapshot,
                  },
                })),
              );
            }
          }
        }

        return { applied: true, entryId: inserted[0]!.id, account };
      });
    },
  };
}
