import { describe, expect, it } from "vitest";

import {
  decideTournamentMatch,
  derivePredictionOutcome,
  evaluateFutureFormatV2Gate,
  planTournamentProgress,
  resolvePrediction,
  type FutureFormatV2Evidence,
  type TournamentMatchDecision,
} from "../src/modules/issues/future-format-policy.js";

const advanced = (entryId: string): TournamentMatchDecision => ({
  status: "ADVANCED",
  advancingChoiceId: `choice-${entryId}`,
  advancingEntryId: entryId,
  resultVersion: 3,
});

const gateEvidence: FutureFormatV2Evidence = {
  format: "TOURNAMENT",
  stablePublicV0Days: 45,
  pickDecision: "NO_GO",
  prototypeParticipants: 12,
  demandEvidenceDocumented: true,
  productCopyApproved: true,
  verticalPolicyApproved: true,
  firstPilotScope: "LOW_RISK_ORIGINAL",
  severeIncidentsInLast30Days: 0,
  tournamentDryRuns: 3,
  tournamentTransitionFailures: 0,
  tournamentReplayMismatches: 0,
  predictionResolutionFixtures: 30,
  predictionAuditFailures: 0,
  overduePredictionResolutions: 0,
};

describe("future Issue format policy", () => {
  it("advances only a winner from a closed and locked Tournament snapshot", () => {
    expect(
      decideTournamentMatch({
        matchState: "VOTING_CLOSED",
        snapshotLocked: true,
        resultVersion: 3,
        choiceAId: "candidate-a",
        choiceBId: "candidate-b",
        entryAId: "entry-a",
        entryBId: "entry-b",
        acceptedA: 18,
        acceptedB: 12,
        minimumAcceptedVotes: 20,
      }),
    ).toEqual({
      status: "ADVANCED",
      advancingChoiceId: "candidate-a",
      advancingEntryId: "entry-a",
      resultVersion: 3,
    });
  });

  it("requires a tiebreaker or more participation instead of inventing a winner", () => {
    const base = {
      matchState: "VOTING_CLOSED" as const,
      snapshotLocked: true,
      resultVersion: 2,
      choiceAId: "candidate-a",
      choiceBId: "candidate-b",
      entryAId: "entry-a",
      entryBId: "entry-b",
      minimumAcceptedVotes: 20,
    };

    expect(decideTournamentMatch({ ...base, acceptedA: 6, acceptedB: 6 })).toEqual({
      status: "BLOCKED",
      reason: "INSUFFICIENT_PARTICIPATION",
    });
    expect(decideTournamentMatch({ ...base, acceptedA: 10, acceptedB: 10 })).toEqual({
      status: "BLOCKED",
      reason: "TIEBREAKER_REQUIRED",
    });
  });

  it("generates deterministic next-round pairings only after every match advances", () => {
    expect(
      planTournamentProgress({
        seriesId: "series-1",
        currentRoundNumber: 1,
        matches: [
          { bracketPosition: 2, decision: advanced("winner-2") },
          { bracketPosition: 1, decision: advanced("winner-1") },
        ],
      }),
    ).toEqual({
      status: "NEXT_ROUND_READY",
      roundNumber: 2,
      matches: [
        {
          generationKey: "series-1:round:2:match:1",
          bracketPosition: 1,
          entryAId: "winner-1",
          entryBId: "winner-2",
        },
      ],
    });
  });

  it("does not create the next round while any match is unresolved", () => {
    expect(
      planTournamentProgress({
        seriesId: "series-1",
        currentRoundNumber: 1,
        matches: [
          { bracketPosition: 1, decision: advanced("winner-1") },
          {
            bracketPosition: 2,
            decision: { status: "BLOCKED", reason: "TIEBREAKER_REQUIRED" },
          },
        ],
      }),
    ).toEqual({ status: "ROUND_BLOCKED", blockedPositions: [2] });
  });

  it("completes a Series with the final advancing Entry", () => {
    expect(
      planTournamentProgress({
        seriesId: "series-1",
        currentRoundNumber: 3,
        matches: [{ bracketPosition: 1, decision: advanced("champion") }],
      }),
    ).toEqual({ status: "SERIES_COMPLETED", winnerEntryId: "champion" });
  });

  it("resolves or voids a Prediction with evidence and append-only revisions", () => {
    const resolved = resolvePrediction({
      currentStatus: "RESOLUTION_PENDING",
      currentRevision: 0,
      choiceIds: ["home", "away"],
      resolvedChoiceId: "home",
      sourceReference: "official-result-42",
    });
    const voided = resolvePrediction({
      currentStatus: "RESOLVED",
      currentRevision: resolved.revision,
      choiceIds: ["home", "away"],
      voidReason: "Official event cancelled",
      sourceReference: "official-cancellation-43",
    });

    expect(resolved).toMatchObject({ status: "RESOLVED", revision: 1, resolvedChoiceId: "home" });
    expect(voided).toMatchObject({ status: "VOID", revision: 2, resolvedChoiceId: null });
    expect(derivePredictionOutcome({ resolution: resolved, votedChoiceId: "home" })).toBe("HIT");
    expect(derivePredictionOutcome({ resolution: resolved, votedChoiceId: "away" })).toBe("MISS");
    expect(derivePredictionOutcome({ resolution: voided, votedChoiceId: "home" })).toBe("VOID");
  });

  it("rejects ambiguous or foreign Prediction resolutions", () => {
    expect(() =>
      resolvePrediction({
        currentStatus: "OPEN",
        currentRevision: 0,
        choiceIds: ["home", "away"],
        resolvedChoiceId: "home",
        sourceReference: "official-result-42",
      }),
    ).toThrow("Prediction is not ready for resolution.");
    expect(() =>
      resolvePrediction({
        currentStatus: "RESOLUTION_PENDING",
        currentRevision: 0,
        choiceIds: ["home", "away"],
        resolvedChoiceId: "draw",
        sourceReference: "official-result-42",
      }),
    ).toThrow("Resolved Choice does not belong to the Prediction.");
  });

  it("keeps v2 blocked until evidence exists and rejects unsafe first-pilot scopes", () => {
    expect(
      evaluateFutureFormatV2Gate({
        ...gateEvidence,
        stablePublicV0Days: 10,
        pickDecision: "PENDING",
        prototypeParticipants: 4,
        demandEvidenceDocumented: false,
        tournamentDryRuns: 1,
      }),
    ).toEqual({
      decision: "INSUFFICIENT_EVIDENCE",
      reasons: [
        "PUBLIC_V0_EVIDENCE_MISSING",
        "PICK_DECISION_PENDING",
        "PROTOTYPE_EVIDENCE_MISSING",
        "FORMAT_DRY_RUN_EVIDENCE_MISSING",
      ],
    });

    expect(
      evaluateFutureFormatV2Gate({
        ...gateEvidence,
        firstPilotScope: "POLITICS_OR_CURRENT_AFFAIRS",
      }),
    ).toEqual({ decision: "NO_GO", reasons: ["FIRST_PILOT_SCOPE_NOT_ALLOWED"] });
    expect(
      evaluateFutureFormatV2Gate({
        ...gateEvidence,
        stablePublicV0Days: 0,
        severeIncidentsInLast30Days: 1,
      }),
    ).toEqual({ decision: "NO_GO", reasons: ["SEVERE_INCIDENT_OPEN"] });
    expect(evaluateFutureFormatV2Gate(gateEvidence)).toEqual({ decision: "GO", reasons: [] });
  });
});
