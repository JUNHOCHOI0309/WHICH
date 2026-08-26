import { and, asc, eq, inArray, isNotNull, notExists } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  commentReactions,
  comments,
  interestProfiles,
  memberDailyAttendances,
  memberProfiles,
  outboxEvents,
  pointEventReceipts,
  shareRewardClaims,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import { createPointLedgerService, PointLedgerError } from "./service.js";

export const POINT_POLICY_VERSION = "w_point_v1";
export const POINT_OPERATION_TIME_ZONE = "Asia/Seoul";

const REWARD_EVENT_TYPES = [
  "MEMBER_DAILY_ATTENDANCE_CONFIRMED",
  "VOTE_ACCEPTED",
  "SHARE_REWARD_CONFIRMED",
  "COMMENT_REACTION_ACTIVATED",
  "INTEREST_PROFILE_COMPLETED",
  "MEMBER_PUBLIC_PROFILE_COMPLETED",
] as const;

type ReceiptOutcome = "AWARDED" | "DUPLICATE" | "CAP_REACHED" | "INELIGIBLE" | "DISABLED";

type RewardFact = {
  memberId: string;
  sourceType: string;
  sourceId: string;
  reasonCode: string;
  counterKey: string;
  amount: number;
  dailyLimit: number;
};

type EventRow = typeof outboxEvents.$inferSelect;

export function operationDayAt(occurredAt: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: POINT_OPERATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(occurredAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function payloadData(event: EventRow) {
  const data = event.payload.data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createPointPolicyConsumer(
  database: Database["db"],
  options: { enabled: boolean; batchSize?: number },
) {
  const ledger = createPointLedgerService(database);

  async function resolveFact(event: EventRow): Promise<RewardFact | null> {
    const data = payloadData(event);
    if (event.eventType === "VOTE_ACCEPTED") {
      const voteId = stringValue(data.vote_id);
      if (!voteId) return null;
      const [fact] = await database
        .select({ memberId: voterSubjects.userId })
        .from(votes)
        .innerJoin(voterSubjects, eq(voterSubjects.id, votes.subjectId))
        .where(
          and(
            eq(votes.id, voteId),
            eq(votes.integrityState, "ACCEPTED"),
            inArray(voterSubjects.kind, ["MEMBER", "VERIFIED_MEMBER"]),
          ),
        )
        .limit(1);
      return fact?.memberId
        ? {
            memberId: fact.memberId,
            sourceType: "VOTE",
            sourceId: voteId,
            reasonCode: "VOTE_ACCEPTED",
            counterKey: "ACCEPTED_VOTE",
            amount: 10,
            dailyLimit: 10,
          }
        : null;
    }

    if (event.eventType === "COMMENT_REACTION_ACTIVATED") {
      const commentId = stringValue(data.comment_id);
      const actorSubjectId = stringValue(data.actor_subject_id);
      if (!commentId || !actorSubjectId) return null;
      const [fact] = await database
        .select({
          reactionId: commentReactions.id,
          memberId: voterSubjects.userId,
          authorSubjectId: comments.authorSubjectId,
        })
        .from(commentReactions)
        .innerJoin(voterSubjects, eq(voterSubjects.id, commentReactions.subjectId))
        .innerJoin(comments, eq(comments.id, commentReactions.commentId))
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.subjectId, actorSubjectId),
            eq(commentReactions.code, "HELPFUL"),
            eq(commentReactions.active, true),
            eq(comments.publicationState, "PUBLISHED"),
            eq(comments.visibility, "VISIBLE"),
            inArray(voterSubjects.kind, ["MEMBER", "VERIFIED_MEMBER"]),
          ),
        )
        .limit(1);
      return fact?.memberId && fact.authorSubjectId !== actorSubjectId
        ? {
            memberId: fact.memberId,
            sourceType: "COMMENT_REACTION",
            sourceId: fact.reactionId,
            reasonCode: "VALID_REACTION",
            counterKey: "VALID_REACTION",
            amount: 10,
            dailyLimit: 3,
          }
        : null;
    }

    if (event.eventType === "SHARE_REWARD_CONFIRMED") {
      const claimId = stringValue(data.share_reward_claim_id);
      if (!claimId) return null;
      const [fact] = await database
        .select({ memberId: shareRewardClaims.memberId })
        .from(shareRewardClaims)
        .where(eq(shareRewardClaims.id, claimId))
        .limit(1);
      return fact
        ? {
            memberId: fact.memberId,
            sourceType: "SHARE_REWARD_CLAIM",
            sourceId: claimId,
            reasonCode: "VERIFIED_SHARE",
            counterKey: "VERIFIED_SHARE",
            amount: 10,
            dailyLimit: 2,
          }
        : null;
    }

    const memberId = stringValue(data.member_id);
    const factId = stringValue(data.fact_id) ?? event.aggregateId;
    if (!memberId) return null;
    if (event.eventType === "MEMBER_DAILY_ATTENDANCE_CONFIRMED") {
      const [attendance] = await database
        .select({ memberId: memberDailyAttendances.memberId })
        .from(memberDailyAttendances)
        .where(
          and(eq(memberDailyAttendances.id, factId), eq(memberDailyAttendances.memberId, memberId)),
        )
        .limit(1);
      if (!attendance) return null;
      return {
        memberId,
        sourceType: "MEMBER_ATTENDANCE",
        sourceId: factId,
        reasonCode: "DAILY_LOGIN",
        counterKey: "DAILY_LOGIN",
        amount: 10,
        dailyLimit: 1,
      };
    }
    if (event.eventType === "INTEREST_PROFILE_COMPLETED") {
      const [profile] = await database
        .select({ memberId: voterSubjects.userId })
        .from(interestProfiles)
        .innerJoin(voterSubjects, eq(voterSubjects.id, interestProfiles.subjectId))
        .where(
          and(
            eq(voterSubjects.userId, memberId),
            eq(interestProfiles.onboardingState, "COMPLETED"),
          ),
        )
        .limit(1);
      if (!profile?.memberId) return null;
      return {
        memberId,
        sourceType: "MEMBER",
        sourceId: memberId,
        reasonCode: "FIRST_INTEREST_PROFILE_COMPLETION",
        counterKey: "ACCOUNT_ONCE_INTEREST",
        amount: 50,
        dailyLimit: 1,
      };
    }
    if (event.eventType === "MEMBER_PUBLIC_PROFILE_COMPLETED") {
      const [profile] = await database
        .select({ memberId: memberProfiles.memberId })
        .from(memberProfiles)
        .where(
          and(
            eq(memberProfiles.memberId, memberId),
            eq(memberProfiles.visibility, "PUBLIC"),
            isNotNull(memberProfiles.bio),
          ),
        )
        .limit(1);
      if (!profile) return null;
      return {
        memberId,
        sourceType: "MEMBER",
        sourceId: memberId,
        reasonCode: "FIRST_PUBLIC_PROFILE_COMPLETION",
        counterKey: "ACCOUNT_ONCE_PUBLIC_PROFILE",
        amount: 50,
        dailyLimit: 1,
      };
    }
    return null;
  }

  async function recordReceipt(
    event: EventRow,
    operationDay: string,
    outcome: ReceiptOutcome,
    ledgerEntryId?: string,
    detail?: string,
  ) {
    await database
      .insert(pointEventReceipts)
      .values({
        eventId: event.id,
        eventType: event.eventType,
        outcome,
        policyVersion: POINT_POLICY_VERSION,
        operationDay,
        ledgerEntryId,
        detail,
      })
      .onConflictDoNothing({ target: pointEventReceipts.eventId });
  }

  async function processEvent(event: EventRow) {
    const operationDay = operationDayAt(event.occurredAt);
    if (!options.enabled) {
      await recordReceipt(event, operationDay, "DISABLED", undefined, "feature_flag_disabled");
      return "DISABLED" as const;
    }
    const fact = await resolveFact(event);
    if (!fact) {
      await recordReceipt(event, operationDay, "INELIGIBLE", undefined, "domain_fact_not_eligible");
      return "INELIGIBLE" as const;
    }
    try {
      const result = await ledger.applyEntry({
        memberId: fact.memberId,
        entryType: "EARN",
        amount: fact.amount,
        reasonCode: fact.reasonCode,
        sourceType: fact.sourceType,
        sourceId: fact.sourceId,
        operationDay,
        idempotencyKey: `outbox:${event.id}:${POINT_POLICY_VERSION}`,
        policyVersion: POINT_POLICY_VERSION,
        counterKey: fact.counterKey,
        dailyQualifyingLimit: fact.dailyLimit,
        dailyPointLimit: fact.dailyLimit * fact.amount,
        metadata: { eventId: event.id, eventType: event.eventType },
      });
      const outcome = result.applied ? "AWARDED" : "DUPLICATE";
      await recordReceipt(event, operationDay, outcome, result.entryId);
      return outcome;
    } catch (error) {
      if (error instanceof PointLedgerError && error.code === "POINT_DAILY_LIMIT_REACHED") {
        await recordReceipt(event, operationDay, "CAP_REACHED", undefined, error.code);
        return "CAP_REACHED" as const;
      }
      if (
        error instanceof PointLedgerError &&
        ["MEMBER_NOT_FOUND", "MEMBER_NOT_ELIGIBLE"].includes(error.code)
      ) {
        await recordReceipt(event, operationDay, "INELIGIBLE", undefined, error.code);
        return "INELIGIBLE" as const;
      }
      throw error;
    }
  }

  return {
    processEvent,
    async processBatch(limit = options.batchSize ?? 100) {
      const events = await database
        .select()
        .from(outboxEvents)
        .where(
          and(
            inArray(outboxEvents.eventType, [...REWARD_EVENT_TYPES]),
            notExists(
              database
                .select({ eventId: pointEventReceipts.eventId })
                .from(pointEventReceipts)
                .where(eq(pointEventReceipts.eventId, outboxEvents.id)),
            ),
          ),
        )
        .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
        .limit(Math.max(1, Math.min(limit, 500)));
      const outcomes = [];
      for (const event of events) outcomes.push(await processEvent(event));
      return { claimed: events.length, outcomes };
    },
  };
}
