import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  analyticsSessions,
  issueChoices,
  issues,
  issueVersions,
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
const INTEGRITY_POLICY_VERSION = "vote-integrity-v1";
const EVENT_SCHEMA_VERSION = 1;

type StoredVoteResponse = GuestVoteSubmissionResult;

function fingerprint(command: GuestVoteSubmission) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        command.idempotencyKey,
        command.anonymousSubjectId,
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
          acceptedVoteCount: 0,
          reviewVoteCount: 0,
          rejectedDuplicateCount: 0,
          rejectedAbuseCount: 0,
          invalidatedVoteCount: 0,
          displayedVoteCount: 0,
        };
        let acceptedWithoutBinaryChoice = 0;

        for (const group of voteGroups) {
          source.voteRequestCount += group.count;
          switch (group.integrityState) {
            case "ACCEPTED":
              source.acceptedVoteCount += group.count;
              source.displayedVoteCount += group.count;
              if (group.choiceCode === "A") source.acceptedACount += group.count;
              else if (group.choiceCode === "B") source.acceptedBCount += group.count;
              else acceptedWithoutBinaryChoice += group.count;
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

        if (acceptedWithoutBinaryChoice > 0) {
          mismatches.push({
            target: "SOURCE",
            field: "acceptedVotesWithBinaryChoice",
            expected: source.acceptedVoteCount,
            actual: source.acceptedVoteCount - acceptedWithoutBinaryChoice,
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

        if (acceptedWithoutBinaryChoice > 0) {
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
      const requestFingerprint = fingerprint(command);

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );

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

        const [subject] = await transaction
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

        await transaction.insert(voteAttempts).values({
          id: command.idempotencyKey,
          idempotencyKey: command.idempotencyKey,
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          choiceId: command.choiceId,
          subjectId: subject.id,
          analyticsSessionId: command.analyticsSessionId,
          requestState: "PROCESSING",
          requestFingerprint,
        });

        if (command.analyticsSessionId) {
          const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000);
          await transaction
            .insert(analyticsSessions)
            .values({
              id: command.analyticsSessionId,
              startedAt: now,
              lastActivityAt: now,
              expiresAt,
            })
            .onConflictDoUpdate({
              target: analyticsSessions.id,
              set: { lastActivityAt: now, expiresAt, updatedAt: now },
            });
        }

        const [existingAcceptedVote] = await transaction
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

        const outcome = existingAcceptedVote ? "REJECTED_DUPLICATE" : "ACCEPTED";
        const effectiveChoice = existingAcceptedVote?.choiceCode ?? votableIssue.choiceCode;
        const reasonCode = existingAcceptedVote
          ? "DUPLICATE_ANONYMOUS_SUBJECT"
          : "ELIGIBLE_LOW_GUEST";
        const [vote] = await transaction
          .insert(votes)
          .values({
            voteAttemptId: command.idempotencyKey,
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            choiceId: command.choiceId,
            subjectId: subject.id,
            analyticsSessionId: command.analyticsSessionId,
            integrityState: outcome,
            reasonCode,
            userTier: "GUEST",
            accountAssurance: "ANONYMOUS",
            uniquenessAssurance: "BROWSER_SUBJECT",
            issueRiskLevel: votableIssue.riskLevel,
            eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
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
              analytics_session_id: command.analyticsSessionId ?? null,
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
