import { describe, expect, it } from "vitest";

import { type BetaOperatorObservation, evaluateLimitedBetaEvidence } from "../src/beta-operator.js";

const plan = {
  schemaVersion: 1 as const,
  betaId: "which-52-limited-beta-v1",
  status: "PLANNED" as const,
  cohort: { targetInvitedUsers: 10, minimumFeedbackResponses: 5 },
  observation: { minimumHours: 168, defaultReviewWindowDays: 7 },
  evidenceThresholds: {
    minimumQualifiedSessions: 10,
    minimumActiveIssues: 24,
    maximumModerationQueue: 5,
    maximumOldestModerationCaseHours: 24,
    maximumVoteAggregateMismatches: 0,
    maximumDeadLetters: 0,
  },
  decisionPolicy: {
    requireNoOpenReleaseBlockers: true as const,
    requireNoUnrecoveredSev1: true as const,
    requireNoUnrecoveredDataIncident: true as const,
    automatedEvidenceDoesNotMakeFinalDecision: true as const,
  },
};

const observation: BetaOperatorObservation = {
  schemaVersion: 1,
  betaId: plan.betaId,
  observationStartedAt: "2026-08-18T00:00:00.000Z",
  observationEndedAt: "2026-08-25T00:00:00.000Z",
  invitedUsers: 10,
  feedbackResponses: 5,
  feedbackThemes: [],
  incidents: [],
  releaseBlockers: [],
  notes: [],
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    plan,
    observation,
    generatedAt: "2026-08-25T00:00:00.000Z",
    measurement: {
      status: "READY" as const,
      funnel: { metrics: { qualifiedSessions: 10 } },
      reconciliation: { voteAggregateProjection: { mismatchedIssues: 0 } },
      contentSupply: { activeIssues: 36 },
    },
    operationalSignals: {
      moderation: {
        reportsInWindow: 0,
        reportedCommentsInWindow: 0,
        currentQueueSize: 0,
        oldestQueueCaseHours: 0,
        decisionsInWindow: 0,
      },
      integrity: {
        acceptedVotes: 10,
        reviewVotes: 0,
        rejectedDuplicateVotes: 0,
        rejectedAbuseVotes: 0,
        invalidatedVotes: 0,
      },
      reliability: { incompleteVoteAttempts: 0, deadLetters: 0 },
      identity: { newMembers: 3 },
    },
    ...overrides,
  } as Parameters<typeof evaluateLimitedBetaEvidence>[0];
}

describe("WHICH-52 limited beta evidence", () => {
  it("becomes ready only after the observation and evidence minimums are met", () => {
    const result = evaluateLimitedBetaEvidence(input());

    expect(result.evidenceStatus).toBe("READY_FOR_DECISION");
    expect(result.reasons).toEqual({ blocking: [], collecting: [] });
  });

  it("keeps collecting while the real-user sample is insufficient", () => {
    const result = evaluateLimitedBetaEvidence(
      input({
        observation: {
          ...observation,
          observationEndedAt: "2026-08-20T00:00:00.000Z",
          invitedUsers: 4,
          feedbackResponses: 2,
        },
        measurement: {
          ...input().measurement,
          status: "INSUFFICIENT_DATA",
          funnel: { metrics: { qualifiedSessions: 3 } },
        },
      }),
    );

    expect(result.evidenceStatus).toBe("COLLECTING");
    expect(result.reasons.collecting).toEqual(
      expect.arrayContaining([
        "OBSERVATION_WINDOW_INCOMPLETE",
        "INVITED_COHORT_BELOW_TARGET",
        "FEEDBACK_SAMPLE_BELOW_TARGET",
        "QUALIFIED_SESSION_SAMPLE_BELOW_TARGET",
        "MEASUREMENT_INSUFFICIENT_DATA",
      ]),
    );
  });

  it("blocks review on unresolved safety, integrity, or operating-capacity evidence", () => {
    const result = evaluateLimitedBetaEvidence(
      input({
        observation: {
          ...observation,
          incidents: [
            {
              incidentId: "incident-1",
              severity: "SEV_1",
              status: "OPEN",
              dataIntegrityImpact: true,
              summary: "Vote facts cannot be reconciled.",
              occurredAt: "2026-08-24T00:00:00.000Z",
              recoveredAt: null,
            },
          ],
        },
        measurement: {
          ...input().measurement,
          status: "DEGRADED",
          reconciliation: { voteAggregateProjection: { mismatchedIssues: 1 } },
        },
        operationalSignals: {
          ...input().operationalSignals,
          moderation: { ...input().operationalSignals.moderation, currentQueueSize: 6 },
          reliability: { incompleteVoteAttempts: 0, deadLetters: 1 },
        },
      }),
    );

    expect(result.evidenceStatus).toBe("BLOCKED");
    expect(result.reasons.blocking).toEqual(
      expect.arrayContaining([
        "OPEN_SEV_1",
        "UNRECOVERED_DATA_INCIDENT",
        "VOTE_AGGREGATE_MISMATCH",
        "MODERATION_QUEUE_OVER_CAPACITY",
        "OUTBOX_DEAD_LETTER_PRESENT",
        "MEASUREMENT_DEGRADED",
      ]),
    );
  });
});
