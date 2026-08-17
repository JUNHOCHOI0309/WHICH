import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
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
  VoteResult,
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
          requestState: "PROCESSING",
          requestFingerprint,
        });

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
