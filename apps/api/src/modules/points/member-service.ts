import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  memberPointBadgeAwards,
  pointAccounts,
  pointBadgePolicies,
  pointLedgerEntries,
} from "../../database/schema/index.js";
import type {
  MemberPointLedgerEntryType,
  MemberPointLedgerItem,
  MemberPointBadgeCode,
  MemberPointService,
} from "./member-contracts.js";
import { POINT_BADGE_POLICY_VERSION } from "./badge-policy.js";
import { operationDayAt } from "./policy.js";

const reasonLabels: Record<string, string> = {
  DAILY_LOGIN: "오늘의 첫 로그인",
  VOTE_ACCEPTED: "투표 참여",
  VERIFIED_SHARE: "결과 공유",
  VALID_REACTION: "공감 보내기",
  FIRST_INTEREST_PROFILE_COMPLETION: "관심사 설정 완료",
  FIRST_PUBLIC_PROFILE_COMPLETION: "공개 프로필 완성",
  VOTE_INVALIDATED: "무효 처리된 투표 회수",
  OPERATOR_ADJUSTMENT: "운영 조정",
};

function friendlyReason(reasonCode: string, entryType: MemberPointLedgerEntryType) {
  const known = reasonLabels[reasonCode];
  if (known) return known;
  if (entryType === "SPEND") return "W Point 사용";
  if (entryType === "REFUND") return "W Point 환급";
  if (entryType === "REVERSAL") return "W Point 회수";
  if (entryType === "ADJUSTMENT") return "W Point 조정";
  return "W Point 적립";
}

export function createMemberPointService(database: Database["db"]): MemberPointService {
  return {
    async getMemberPoints(memberId, query) {
      const operationDay = operationDayAt(new Date());
      const cursorCondition = query.cursor
        ? or(
            lt(pointLedgerEntries.createdAt, query.cursor.createdAt),
            and(
              eq(pointLedgerEntries.createdAt, query.cursor.createdAt),
              lt(pointLedgerEntries.id, query.cursor.entryId),
            ),
          )
        : undefined;

      const [accountRows, todayRows, ledgerRows, badgePolicies, badgeAwards] = await Promise.all([
        database
          .select({
            cachedBalance: pointAccounts.cachedBalance,
            restrictedDebt: pointAccounts.restrictedDebt,
            lifetimeEarned: pointAccounts.lifetimeEarned,
            lifetimeSpent: pointAccounts.lifetimeSpent,
          })
          .from(pointAccounts)
          .where(eq(pointAccounts.memberId, memberId))
          .limit(1),
        database
          .select({
            value: sql<number>`coalesce(sum(case when ${pointLedgerEntries.amount} > 0 then ${pointLedgerEntries.amount} else 0 end), 0)::int`,
          })
          .from(pointLedgerEntries)
          .where(
            and(
              eq(pointLedgerEntries.memberId, memberId),
              eq(pointLedgerEntries.operationDay, operationDay),
              eq(pointLedgerEntries.entryType, "EARN"),
            ),
          ),
        database
          .select({
            id: pointLedgerEntries.id,
            entryType: pointLedgerEntries.entryType,
            amount: pointLedgerEntries.amount,
            reasonCode: pointLedgerEntries.reasonCode,
            createdAt: pointLedgerEntries.createdAt,
          })
          .from(pointLedgerEntries)
          .where(
            cursorCondition
              ? and(eq(pointLedgerEntries.memberId, memberId), cursorCondition)
              : eq(pointLedgerEntries.memberId, memberId),
          )
          .orderBy(desc(pointLedgerEntries.createdAt), desc(pointLedgerEntries.id))
          .limit(query.limit + 1),
        database
          .select({
            code: pointBadgePolicies.badgeCode,
            label: pointBadgePolicies.label,
            minimumLifetimePoints: pointBadgePolicies.minimumLifetimePoints,
            assetKey: pointBadgePolicies.assetKey,
          })
          .from(pointBadgePolicies)
          .where(eq(pointBadgePolicies.policyVersion, POINT_BADGE_POLICY_VERSION))
          .orderBy(asc(pointBadgePolicies.displayOrder)),
        database
          .select({
            code: memberPointBadgeAwards.badgeCode,
            awardedAt: memberPointBadgeAwards.awardedAt,
          })
          .from(memberPointBadgeAwards)
          .where(eq(memberPointBadgeAwards.memberId, memberId)),
      ]);

      const account = accountRows[0];
      const hasNextPage = ledgerRows.length > query.limit;
      const visibleRows = ledgerRows.slice(0, query.limit);
      const items: MemberPointLedgerItem[] = visibleRows.map((row) => ({
        id: row.id,
        entryType: row.entryType,
        amount: row.amount,
        reasonCode: row.reasonCode,
        reasonLabel: friendlyReason(row.reasonCode, row.entryType),
        createdAt: row.createdAt.toISOString(),
      }));
      const last = hasNextPage ? visibleRows.at(-1) : undefined;
      const awardedAtByCode = new Map(
        badgeAwards.map((award) => [award.code, award.awardedAt.toISOString()]),
      );
      const awardedPolicies = badgePolicies.filter((policy) => awardedAtByCode.has(policy.code));
      const currentPolicy = awardedPolicies.at(-1) ?? null;
      const nextPolicy = currentPolicy
        ? (badgePolicies[
            badgePolicies.findIndex((policy) => policy.code === currentPolicy.code) + 1
          ] ?? null)
        : (badgePolicies[0] ?? null);
      const lifetimeEarned = account?.lifetimeEarned ?? 0;
      const progressStart = currentPolicy?.minimumLifetimePoints ?? 0;
      const progressEnd = nextPolicy?.minimumLifetimePoints ?? progressStart;
      const progress = nextPolicy
        ? Math.min(1, Math.max(0, (lifetimeEarned - progressStart) / (progressEnd - progressStart)))
        : currentPolicy
          ? 1
          : 0;
      const toBadge = (policy: (typeof badgePolicies)[number], includeAwardedAt = false) => ({
        code: policy.code as MemberPointBadgeCode,
        label: policy.label,
        minimumLifetimePoints: policy.minimumLifetimePoints,
        assetKey: policy.assetKey,
        ...(includeAwardedAt ? { awardedAt: awardedAtByCode.get(policy.code)! } : {}),
      });

      return {
        account: {
          balance: account?.cachedBalance ?? 0,
          todayEarned: todayRows[0]?.value ?? 0,
          lifetimeEarned: account?.lifetimeEarned ?? 0,
          lifetimeSpent: account?.lifetimeSpent ?? 0,
          hasPendingRecovery: (account?.restrictedDebt ?? 0) > 0,
        },
        badge: {
          policyVersion: POINT_BADGE_POLICY_VERSION,
          current: currentPolicy ? toBadge(currentPolicy, true) : null,
          next: nextPolicy ? toBadge(nextPolicy) : null,
          progress,
        },
        ledger: {
          items,
          nextCursor: last
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt.toISOString(), entryId: last.id }),
              ).toString("base64url")
            : null,
        },
      };
    },
  };
}
