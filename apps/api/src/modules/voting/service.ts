import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  analyticsSessions,
  guestMemberLinks,
  issueChoices,
  issues,
  issueVersions,
  members,
  memberSessions,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
  voteAttempts,
  voteIntegrityDecisions,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type {
  GuestVoteResponse,
  GuestVoteService,
  GuestVoteSubmission,
  GuestVoteSubmissionResult,
  VoteAggregateView,
  VoteLedgerCounts,
  VoteReconciliationMismatch,
  VoteResult,
  VoteSnapshotView,
} from "./contracts.js";
import { GuestVoteError } from "./errors.js";
import { isGuestIssueAvailable } from "../issues/policy.js";

const ELIGIBILITY_POLICY_VERSION = "guest-low-v1";
const MEMBER_ELIGIBILITY_POLICY_VERSION = "member-account-v1";
const INTEGRITY_POLICY_VERSION = "vote-integrity-v1";
const EVENT_SCHEMA_VERSION = 1;

type StoredVoteResponse = GuestVoteSubmissionResult;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function fingerprint(command: GuestVoteSubmission, subjectId: string, isMemberVote: boolean) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        command.idempotencyKey,
        isMemberVote ? `MEMBER:${subjectId}` : command.anonymousSubjectId,
        command.issueId,
        command.issueVersion,
        command.choiceId,
      ]),
    )
    .digest("hex");
}

function isStoredVoteResponse(value: unknown): value is StoredVoteResponse {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<StoredVoteResponse>;
  return (
    (candidate.httpStatus === 201 || candidate.httpStatus === 409) &&
    typeof candidate.body === "object" &&
    candidate.body !== null &&
    (candidate.body.outcome === "ACCEPTED" || candidate.body.outcome === "REJECTED_DUPLICATE")
  );
}

function toVoteResult(aggregate: typeof voteAggregates.$inferSelect): VoteResult {
  return {
    resultVersion: aggregate.resultVersion,
    acceptedA: aggregate.acceptedACount,
    acceptedB: aggregate.acceptedBCount,
    acceptedC: aggregate.acceptedCCount,
    acceptedD: aggregate.acceptedDCount,
    displayedTotal: aggregate.displayedVoteCount,
    integrityState: aggregate.integrityState,
  };
}

function toAggregateView(aggregate: typeof voteAggregates.$inferSelect): VoteAggregateView {
  return {
    resultVersion: aggregate.resultVersion,
    voteRequestCount: aggregate.voteRequestCount,
    acceptedACount: aggregate.acceptedACount,
    acceptedBCount: aggregate.acceptedBCount,
    acceptedCCount: aggregate.acceptedCCount,
    acceptedDCount: aggregate.acceptedDCount,
    acceptedVoteCount: aggregate.acceptedVoteCount,
    reviewVoteCount: aggregate.reviewVoteCount,
    rejectedDuplicateCount: aggregate.rejectedDuplicateCount,
    rejectedAbuseCount: aggregate.rejectedAbuseCount,
    invalidatedVoteCount: aggregate.invalidatedVoteCount,
    displayedVoteCount: aggregate.displayedVoteCount,
    integrityState: aggregate.integrityState,
  };
}

function toSnapshotView(snapshot: typeof resultSnapshots.$inferSelect): VoteSnapshotView {
  return {
    resultVersion: snapshot.resultVersion,
    acceptedACount: snapshot.acceptedACount,
    acceptedBCount: snapshot.acceptedBCount,
    acceptedCCount: snapshot.acceptedCCount,
    acceptedDCount: snapshot.acceptedDCount,
    displayedVoteCount: snapshot.displayedVoteCount,
    integrityState: snapshot.integrityState,
  };
}

function appendMismatch(
  mismatches: VoteReconciliationMismatch[],
  target: VoteReconciliationMismatch["target"],
  field: string,
  expected: VoteReconciliationMismatch["expected"],
  actual: VoteReconciliationMismatch["actual"],
) {
  if (expected !== actual) mismatches.push({ target, field, expected, actual });
}

export function createGuestVoteService(database: Database["db"]): GuestVoteService {
  return {
    async createGuestSubject() {
      const anonymousSubjectId = randomUUID();

      await database.insert(voterSubjects).values({
        kind: "GUEST",
        anonymousSubjectId,
      });

      return { anonymousSubjectId };
    },

    async findGuestVote(query) {
      const [guestSubject] = await database
        .select({ id: voterSubjects.id })
        .from(voterSubjects)
        .where(
          and(
            eq(voterSubjects.kind, "GUEST"),
            eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId),
          ),
        )
        .limit(1);
      if (!guestSubject) return null;

      const [storedVote] = await database
        .select({
          voteId: votes.id,
          voteAttemptId: votes.voteAttemptId,
          issueVersion: votes.issueVersion,
          choice: issueChoices.code,
          resultVersion: voteAggregates.resultVersion,
          acceptedA: voteAggregates.acceptedACount,
          acceptedB: voteAggregates.acceptedBCount,
          acceptedC: voteAggregates.acceptedCCount,
          acceptedD: voteAggregates.acceptedDCount,
          displayedTotal: voteAggregates.displayedVoteCount,
          resultIntegrityState: voteAggregates.integrityState,
        })
        .from(votes)
        .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
        .innerJoin(
          voteAggregates,
          and(
            eq(voteAggregates.issueId, votes.issueId),
            eq(voteAggregates.issueVersion, votes.issueVersion),
          ),
        )
        .where(
          and(
            eq(votes.issueId, query.issueId),
            eq(votes.subjectId, guestSubject.id),
            eq(votes.integrityState, "ACCEPTED"),
          ),
        )
        .orderBy(desc(votes.acceptedAt), desc(votes.id))
        .limit(1);
      if (!storedVote) return null;

      return {
        outcome: "ACCEPTED",
        voteAttemptId: storedVote.voteAttemptId,
        voteId: storedVote.voteId,
        issueId: query.issueId,
        issueVersion: storedVote.issueVersion,
        choice: storedVote.choice,
        result: {
          resultVersion: storedVote.resultVersion,
          acceptedA: storedVote.acceptedA,
          acceptedB: storedVote.acceptedB,
          acceptedC: storedVote.acceptedC,
          acceptedD: storedVote.acceptedD,
          displayedTotal: storedVote.displayedTotal,
          integrityState: storedVote.resultIntegrityState,
        },
      };
    },

    async reconcileIssueVersion(command) {
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${command.issueId}:${command.issueVersion}:vote-reconciliation`}, 0))`,
        );

        const [issueVersion] = await transaction
          .select({
            issueId: issueVersions.issueId,
            resultVisibility: issues.resultVisibility,
          })
          .from(issueVersions)
          .innerJoin(issues, eq(issues.id, issueVersions.issueId))
          .where(
            and(
              eq(issueVersions.issueId, command.issueId),
              eq(issueVersions.version, command.issueVersion),
            ),
          )
          .limit(1)
          .for("update");

        if (!issueVersion) {
          throw new GuestVoteError(
            "ISSUE_VERSION_NOT_FOUND",
            404,
            "The requested Issue Version does not exist.",
          );
        }

        const [aggregate] = await transaction
          .select()
          .from(voteAggregates)
          .where(
            and(
              eq(voteAggregates.issueId, command.issueId),
              eq(voteAggregates.issueVersion, command.issueVersion),
            ),
          )
          .limit(1)
          .for("update");
        const [latestSnapshot] = await transaction
          .select()
          .from(resultSnapshots)
          .where(
            and(
              eq(resultSnapshots.issueId, command.issueId),
              eq(resultSnapshots.issueVersion, command.issueVersion),
            ),
          )
          .orderBy(desc(resultSnapshots.resultVersion))
          .limit(1);
        const voteGroups = await transaction
          .select({
            integrityState: votes.integrityState,
            choiceCode: issueChoices.code,
            count: sql<number>`count(*)::int`,
          })
          .from(votes)
          .leftJoin(
            issueChoices,
            and(
              eq(issueChoices.issueId, votes.issueId),
              eq(issueChoices.issueVersion, votes.issueVersion),
              eq(issueChoices.id, votes.choiceId),
            ),
          )
          .where(
            and(eq(votes.issueId, command.issueId), eq(votes.issueVersion, command.issueVersion)),
          )
          .groupBy(votes.integrityState, issueChoices.code);

        const source: VoteLedgerCounts = {
          voteRequestCount: 0,
          acceptedACount: 0,
          acceptedBCount: 0,
          acceptedCCount: 0,
          acceptedDCount: 0,
          acceptedVoteCount: 0,
          reviewVoteCount: 0,
          rejectedDuplicateCount: 0,
          rejectedAbuseCount: 0,
          invalidatedVoteCount: 0,
          displayedVoteCount: 0,
        };
        let acceptedWithoutSupportedChoice = 0;

        for (const group of voteGroups) {
          source.voteRequestCount += group.count;
          switch (group.integrityState) {
            case "ACCEPTED":
              source.acceptedVoteCount += group.count;
              source.displayedVoteCount += group.count;
              if (group.choiceCode === "A") source.acceptedACount += group.count;
              else if (group.choiceCode === "B") source.acceptedBCount += group.count;
              else if (group.choiceCode === "C") source.acceptedCCount += group.count;
              else if (group.choiceCode === "D") source.acceptedDCount += group.count;
              else acceptedWithoutSupportedChoice += group.count;
              break;
            case "REVIEW":
              source.reviewVoteCount += group.count;
              break;
            case "REJECTED_DUPLICATE":
              source.rejectedDuplicateCount += group.count;
              break;
            case "REJECTED_ABUSE":
              source.rejectedAbuseCount += group.count;
              break;
            case "INVALIDATED":
              source.invalidatedVoteCount += group.count;
              break;
          }
        }

        const aggregateBefore = aggregate ? toAggregateView(aggregate) : null;
        const latestSnapshotBefore = latestSnapshot ? toSnapshotView(latestSnapshot) : null;
        const mismatches: VoteReconciliationMismatch[] = [];

        if (acceptedWithoutSupportedChoice > 0) {
          mismatches.push({
            target: "SOURCE",
            field: "acceptedVotesWithSupportedChoice",
            expected: source.acceptedVoteCount,
            actual: source.acceptedVoteCount - acceptedWithoutSupportedChoice,
          });
        }

        if (!aggregateBefore) {
          mismatches.push({ target: "AGGREGATE", field: "exists", expected: true, actual: false });
        } else {
          const countFields = Object.keys(source) as Array<keyof VoteLedgerCounts>;
          for (const field of countFields) {
            appendMismatch(mismatches, "AGGREGATE", field, source[field], aggregateBefore[field]);
          }
        }

        if (aggregateBefore && !latestSnapshotBefore) {
          mismatches.push({
            target: "LATEST_SNAPSHOT",
            field: "exists",
            expected: true,
            actual: false,
          });
        } else if (aggregateBefore && latestSnapshotBefore) {
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "resultVersion",
            aggregateBefore.resultVersion,
            latestSnapshotBefore.resultVersion,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "acceptedACount",
            aggregateBefore.acceptedACount,
            latestSnapshotBefore.acceptedACount,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "acceptedBCount",
            aggregateBefore.acceptedBCount,
            latestSnapshotBefore.acceptedBCount,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "acceptedCCount",
            aggregateBefore.acceptedCCount,
            latestSnapshotBefore.acceptedCCount,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "acceptedDCount",
            aggregateBefore.acceptedDCount,
            latestSnapshotBefore.acceptedDCount,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "displayedVoteCount",
            aggregateBefore.displayedVoteCount,
            latestSnapshotBefore.displayedVoteCount,
          );
          appendMismatch(
            mismatches,
            "LATEST_SNAPSHOT",
            "integrityState",
            aggregateBefore.integrityState,
            latestSnapshotBefore.integrityState,
          );
        } else if (!aggregateBefore && latestSnapshotBefore) {
          mismatches.push({
            target: "LATEST_SNAPSHOT",
            field: "aggregateResultVersion",
            expected: null,
            actual: latestSnapshotBefore.resultVersion,
          });
        }

        const checkedAt = new Date();
        const baseResult = {
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          mode: command.mode,
          checkedAt: checkedAt.toISOString(),
          source,
          aggregateBefore,
          latestSnapshotBefore,
          mismatches,
        };

        if (mismatches.length === 0) {
          return { ...baseResult, status: "CONSISTENT" as const, resultAfter: aggregateBefore };
        }
        if (command.mode === "DRY_RUN") {
          return { ...baseResult, status: "MISMATCH_FOUND" as const, resultAfter: null };
        }

        if (acceptedWithoutSupportedChoice > 0) {
          const alreadyLocked =
            issueVersion.resultVisibility === "RESULT_LOCKED" &&
            (!aggregate || aggregate.integrityState === "RESULT_LOCKED");

          if (!alreadyLocked) {
            await transaction
              .update(issues)
              .set({ resultVisibility: "RESULT_LOCKED", updatedAt: checkedAt })
              .where(eq(issues.id, command.issueId));
            if (aggregate) {
              await transaction
                .update(voteAggregates)
                .set({ integrityState: "RESULT_LOCKED", updatedAt: checkedAt })
                .where(
                  and(
                    eq(voteAggregates.issueId, command.issueId),
                    eq(voteAggregates.issueVersion, command.issueVersion),
                  ),
                );
            }

            const eventId = randomUUID();
            await transaction.insert(outboxEvents).values({
              id: eventId,
              aggregateType: "ISSUE_VERSION",
              aggregateId: `${command.issueId}:${command.issueVersion}`,
              eventType: "RESULT_RECONCILIATION_LOCKED",
              schemaVersion: EVENT_SCHEMA_VERSION,
              occurredAt: checkedAt,
              payload: {
                event_id: eventId,
                event_type: "RESULT_RECONCILIATION_LOCKED",
                schema_version: EVENT_SCHEMA_VERSION,
                occurred_at: checkedAt.toISOString(),
                aggregate_type: "ISSUE_VERSION",
                aggregate_id: `${command.issueId}:${command.issueVersion}`,
                data: { mismatches },
              },
            });
          }

          return { ...baseResult, status: "RESULT_LOCKED" as const, resultAfter: null };
        }

        const nextResultVersion =
          Math.max(aggregate?.resultVersion ?? 0, latestSnapshot?.resultVersion ?? 0) + 1;
        const [repairedAggregate] = await transaction
          .insert(voteAggregates)
          .values({
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            resultVersion: nextResultVersion,
            ...source,
            integrityState: "CORRECTED",
            calculatedAt: checkedAt,
            updatedAt: checkedAt,
          })
          .onConflictDoUpdate({
            target: [voteAggregates.issueId, voteAggregates.issueVersion],
            set: {
              resultVersion: nextResultVersion,
              ...source,
              integrityState: "CORRECTED",
              calculatedAt: checkedAt,
              updatedAt: checkedAt,
            },
          })
          .returning();

        if (!repairedAggregate) throw new Error("Vote aggregate repair did not return a row.");

        await transaction.insert(resultSnapshots).values({
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          resultVersion: nextResultVersion,
          acceptedACount: source.acceptedACount,
          acceptedBCount: source.acceptedBCount,
          acceptedCCount: source.acceptedCCount,
          acceptedDCount: source.acceptedDCount,
          displayedVoteCount: source.displayedVoteCount,
          integrityState: "CORRECTED",
          calculatedAt: checkedAt,
        });

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "ISSUE_VERSION",
          aggregateId: `${command.issueId}:${command.issueVersion}`,
          eventType: "RESULT_AGGREGATE_REBUILT",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: checkedAt,
          payload: {
            event_id: eventId,
            event_type: "RESULT_AGGREGATE_REBUILT",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: checkedAt.toISOString(),
            aggregate_type: "ISSUE_VERSION",
            aggregate_id: `${command.issueId}:${command.issueVersion}`,
            data: {
              mode: command.mode,
              previous: aggregateBefore,
              rebuilt: toAggregateView(repairedAggregate),
              mismatches,
            },
          },
        });

        return {
          ...baseResult,
          status: "REPAIRED" as const,
          resultAfter: toAggregateView(repairedAggregate),
        };
      });
    },

    async submitGuestVote(command) {
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );

        let subject: { id: string; memberId?: string } | undefined;
        let isMemberVote = false;

        if (command.sessionToken) {
          [subject] = await transaction
            .select({ id: voterSubjects.id, memberId: members.id })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, new Date()),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (!subject) {
            throw new GuestVoteError(
              "SESSION_REQUIRED",
              401,
              "An active Member session is required.",
            );
          }
          isMemberVote = true;
          await transaction
            .update(voterSubjects)
            .set({ lastSeenAt: new Date() })
            .where(eq(voterSubjects.id, subject.id));
        } else {
          if (!command.anonymousSubjectId) {
            throw new GuestVoteError(
              "VOTE_SUBJECT_REQUIRED",
              400,
              "A Guest subject or active Member session is required.",
            );
          }
          [subject] = await transaction
            .update(voterSubjects)
            .set({ lastSeenAt: new Date() })
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
              ),
            )
            .returning({ id: voterSubjects.id });
          if (!subject) {
            throw new GuestVoteError(
              "GUEST_SUBJECT_NOT_FOUND",
              404,
              "Create a guest subject before submitting a vote.",
            );
          }
        }

        const requestFingerprint = fingerprint(command, subject.id, isMemberVote);
        const [existingAttempt] = await transaction
          .select({
            requestFingerprint: voteAttempts.requestFingerprint,
            responseSnapshot: voteAttempts.responseSnapshot,
          })
          .from(voteAttempts)
          .where(eq(voteAttempts.idempotencyKey, command.idempotencyKey))
          .limit(1);

        if (existingAttempt) {
          if (existingAttempt.requestFingerprint !== requestFingerprint) {
            throw new GuestVoteError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "The Idempotency-Key was already used for a different vote request.",
            );
          }

          if (!isStoredVoteResponse(existingAttempt.responseSnapshot)) {
            throw new GuestVoteError(
              "IDEMPOTENCY_INCOMPLETE",
              409,
              "The original vote request has not reached a reusable result.",
            );
          }

          return existingAttempt.responseSnapshot;
        }

        const [votableIssue] = await transaction
          .select({
            issueId: issues.id,
            lifecycle: issues.lifecycle,
            visibility: issues.visibility,
            participation: issues.participation,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
            voteOpenAt: issues.voteOpenAt,
            voteCloseAt: issues.voteCloseAt,
            issueVersion: issueVersions.version,
            choiceId: issueChoices.id,
            choiceCode: issueChoices.code,
          })
          .from(issues)
          .innerJoin(
            issueVersions,
            and(
              eq(issueVersions.issueId, issues.id),
              eq(issueVersions.version, command.issueVersion),
            ),
          )
          .innerJoin(
            issueChoices,
            and(
              eq(issueChoices.issueId, issues.id),
              eq(issueChoices.issueVersion, issueVersions.version),
              eq(issueChoices.id, command.choiceId),
            ),
          )
          .where(eq(issues.id, command.issueId))
          .limit(1)
          .for("update");

        if (!votableIssue) {
          throw new GuestVoteError(
            "ISSUE_OR_CHOICE_NOT_FOUND",
            404,
            "The requested Issue Version or Choice does not exist.",
          );
        }

        const now = new Date();
        if (!isGuestIssueAvailable(votableIssue, now)) {
          throw new GuestVoteError(
            "ISSUE_NOT_VOTABLE",
            409,
            "This Issue is not available for a Guest vote.",
          );
        }

        const [analyticsSession] = command.analyticsSessionId
          ? await transaction
              .select({ id: analyticsSessions.id })
              .from(analyticsSessions)
              .where(eq(analyticsSessions.id, command.analyticsSessionId))
              .limit(1)
              .for("key share")
          : [];
        const analyticsSessionId = analyticsSession?.id ?? null;

        await transaction.insert(voteAttempts).values({
          id: command.idempotencyKey,
          idempotencyKey: command.idempotencyKey,
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          choiceId: command.choiceId,
          subjectId: subject.id,
          analyticsSessionId,
          requestState: "PROCESSING",
          requestFingerprint,
        });

        let [existingAcceptedVote] = await transaction
          .select({
            id: votes.id,
            choiceCode: issueChoices.code,
          })
          .from(votes)
          .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
          .where(
            and(
              eq(votes.issueId, command.issueId),
              eq(votes.subjectId, subject.id),
              eq(votes.integrityState, "ACCEPTED"),
            ),
          )
          .limit(1);

        if (!existingAcceptedVote && isMemberVote) {
          [existingAcceptedVote] = await transaction
            .select({ id: votes.id, choiceCode: issueChoices.code })
            .from(guestMemberLinks)
            .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
            .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
            .where(
              and(
                eq(guestMemberLinks.memberSubjectId, subject.id),
                eq(votes.issueId, command.issueId),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .orderBy(desc(votes.acceptedAt), desc(votes.id))
            .limit(1);
        }

        if (
          !existingAcceptedVote &&
          isMemberVote &&
          subject.memberId &&
          command.anonymousSubjectId
        ) {
          [existingAcceptedVote] = await transaction
            .select({ id: votes.id, choiceCode: issueChoices.code })
            .from(voterSubjects)
            .innerJoin(votes, eq(votes.subjectId, voterSubjects.id))
            .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
            .leftJoin(guestMemberLinks, eq(guestMemberLinks.guestSubjectId, voterSubjects.id))
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
                eq(votes.issueId, command.issueId),
                eq(votes.integrityState, "ACCEPTED"),
                or(
                  isNull(guestMemberLinks.memberId),
                  eq(guestMemberLinks.memberId, subject.memberId),
                ),
              ),
            )
            .orderBy(desc(votes.acceptedAt), desc(votes.id))
            .limit(1);
        }

        const outcome = existingAcceptedVote ? "REJECTED_DUPLICATE" : "ACCEPTED";
        const effectiveChoice = existingAcceptedVote?.choiceCode ?? votableIssue.choiceCode;
        const reasonCode = existingAcceptedVote
          ? isMemberVote
            ? "DUPLICATE_MEMBER_OR_LINKED_SUBJECT"
            : "DUPLICATE_ANONYMOUS_SUBJECT"
          : isMemberVote
            ? "ELIGIBLE_ACTIVE_MEMBER"
            : "ELIGIBLE_LOW_GUEST";
        const [vote] = await transaction
          .insert(votes)
          .values({
            voteAttemptId: command.idempotencyKey,
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            choiceId: command.choiceId,
            subjectId: subject.id,
            analyticsSessionId,
            integrityState: outcome,
            reasonCode,
            userTier: isMemberVote ? "MEMBER" : "GUEST",
            accountAssurance: isMemberVote ? "ACCOUNT" : "ANONYMOUS",
            uniquenessAssurance: isMemberVote ? "ACCOUNT" : "BROWSER_SUBJECT",
            issueRiskLevel: votableIssue.riskLevel,
            eligibilityPolicyVersion: isMemberVote
              ? MEMBER_ELIGIBILITY_POLICY_VERSION
              : ELIGIBILITY_POLICY_VERSION,
            integrityPolicyVersion: INTEGRITY_POLICY_VERSION,
            acceptedAt: outcome === "ACCEPTED" ? now : null,
          })
          .returning({ id: votes.id });

        if (!vote) throw new Error("Vote insert did not return a row.");

        await transaction.insert(voteIntegrityDecisions).values({
          voteId: vote.id,
          revision: 1,
          toState: outcome,
          reasonCode,
          policyVersion: INTEGRITY_POLICY_VERSION,
          actorType: "SYSTEM",
        });

        if (outcome === "ACCEPTED") {
          await transaction
            .update(issueVersions)
            .set({ lockedAt: sql`coalesce(${issueVersions.lockedAt}, ${now})` })
            .where(
              and(
                eq(issueVersions.issueId, command.issueId),
                eq(issueVersions.version, command.issueVersion),
              ),
            );
        }

        const acceptedAIncrement = outcome === "ACCEPTED" && effectiveChoice === "A" ? 1 : 0;
        const acceptedBIncrement = outcome === "ACCEPTED" && effectiveChoice === "B" ? 1 : 0;
        const acceptedCIncrement = outcome === "ACCEPTED" && effectiveChoice === "C" ? 1 : 0;
        const acceptedDIncrement = outcome === "ACCEPTED" && effectiveChoice === "D" ? 1 : 0;
        const acceptedIncrement = outcome === "ACCEPTED" ? 1 : 0;
        const duplicateIncrement = outcome === "REJECTED_DUPLICATE" ? 1 : 0;

        const [aggregate] = await transaction
          .insert(voteAggregates)
          .values({
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            resultVersion: 1,
            voteRequestCount: 1,
            acceptedACount: acceptedAIncrement,
            acceptedBCount: acceptedBIncrement,
            acceptedCCount: acceptedCIncrement,
            acceptedDCount: acceptedDIncrement,
            acceptedVoteCount: acceptedIncrement,
            displayedVoteCount: acceptedIncrement,
            rejectedDuplicateCount: duplicateIncrement,
            calculatedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [voteAggregates.issueId, voteAggregates.issueVersion],
            set: {
              resultVersion: sql`${voteAggregates.resultVersion} + 1`,
              voteRequestCount: sql`${voteAggregates.voteRequestCount} + 1`,
              acceptedACount: sql`${voteAggregates.acceptedACount} + ${acceptedAIncrement}`,
              acceptedBCount: sql`${voteAggregates.acceptedBCount} + ${acceptedBIncrement}`,
              acceptedCCount: sql`${voteAggregates.acceptedCCount} + ${acceptedCIncrement}`,
              acceptedDCount: sql`${voteAggregates.acceptedDCount} + ${acceptedDIncrement}`,
              acceptedVoteCount: sql`${voteAggregates.acceptedVoteCount} + ${acceptedIncrement}`,
              displayedVoteCount: sql`${voteAggregates.displayedVoteCount} + ${acceptedIncrement}`,
              rejectedDuplicateCount: sql`${voteAggregates.rejectedDuplicateCount} + ${duplicateIncrement}`,
              calculatedAt: now,
              updatedAt: now,
            },
          })
          .returning();

        if (!aggregate) throw new Error("Vote aggregate upsert did not return a row.");

        await transaction.insert(resultSnapshots).values({
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          resultVersion: aggregate.resultVersion,
          acceptedACount: aggregate.acceptedACount,
          acceptedBCount: aggregate.acceptedBCount,
          acceptedCCount: aggregate.acceptedCCount,
          acceptedDCount: aggregate.acceptedDCount,
          displayedVoteCount: aggregate.displayedVoteCount,
          integrityState: aggregate.integrityState,
          calculatedAt: now,
        });

        const eventId = randomUUID();
        const eventType = outcome === "ACCEPTED" ? "VOTE_ACCEPTED" : "VOTE_REJECTED";
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "ISSUE_VERSION",
          aggregateId: `${command.issueId}:${command.issueVersion}`,
          eventType,
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: eventType,
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "ISSUE_VERSION",
            aggregate_id: `${command.issueId}:${command.issueVersion}`,
            data: {
              vote_id: vote.id,
              vote_attempt_id: command.idempotencyKey,
              issue_id: command.issueId,
              issue_version: command.issueVersion,
              choice: effectiveChoice,
              integrity_state: outcome,
              result_version: aggregate.resultVersion,
              analytics_session_id: analyticsSessionId,
            },
          },
        });

        const body: GuestVoteResponse = {
          outcome,
          voteAttemptId: command.idempotencyKey,
          voteId: vote.id,
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          choice: effectiveChoice,
          result: toVoteResult(aggregate),
        };
        const response: GuestVoteSubmissionResult = {
          httpStatus: outcome === "ACCEPTED" ? 201 : 409,
          body,
        };

        await transaction
          .update(voteAttempts)
          .set({
            requestState: "COMPLETED",
            completedAt: now,
            responseSnapshot: response,
          })
          .where(eq(voteAttempts.id, command.idempotencyKey));

        return response;
      });
    },
  };
}
