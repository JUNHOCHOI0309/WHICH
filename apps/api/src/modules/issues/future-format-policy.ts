export const FUTURE_FORMAT_POLICY_VERSION = "which-future-formats-v1";

export type TournamentMatchSnapshot = {
  matchState: "SCHEDULED" | "VOTING_OPEN" | "VOTING_CLOSED" | "ADVANCED" | "VOID";
  snapshotLocked: boolean;
  resultVersion: number;
  choiceAId: string;
  choiceBId: string;
  entryAId: string;
  entryBId: string;
  acceptedA: number;
  acceptedB: number;
  minimumAcceptedVotes: number;
};

export type TournamentMatchDecision =
  | {
      status: "ADVANCED";
      advancingChoiceId: string;
      advancingEntryId: string;
      resultVersion: number;
    }
  | {
      status: "BLOCKED";
      reason:
        | "MATCH_NOT_CLOSED"
        | "RESULT_NOT_LOCKED"
        | "INSUFFICIENT_PARTICIPATION"
        | "TIEBREAKER_REQUIRED";
    };

export function decideTournamentMatch(snapshot: TournamentMatchSnapshot): TournamentMatchDecision {
  if (snapshot.matchState !== "VOTING_CLOSED") {
    return { status: "BLOCKED", reason: "MATCH_NOT_CLOSED" };
  }
  if (!snapshot.snapshotLocked) {
    return { status: "BLOCKED", reason: "RESULT_NOT_LOCKED" };
  }
  if (
    snapshot.resultVersion < 1 ||
    snapshot.acceptedA < 0 ||
    snapshot.acceptedB < 0 ||
    snapshot.minimumAcceptedVotes < 1 ||
    snapshot.choiceAId === snapshot.choiceBId ||
    snapshot.entryAId === snapshot.entryBId
  ) {
    throw new Error("Invalid Tournament match snapshot.");
  }

  if (snapshot.acceptedA + snapshot.acceptedB < snapshot.minimumAcceptedVotes) {
    return { status: "BLOCKED", reason: "INSUFFICIENT_PARTICIPATION" };
  }
  if (snapshot.acceptedA === snapshot.acceptedB) {
    return { status: "BLOCKED", reason: "TIEBREAKER_REQUIRED" };
  }

  return {
    status: "ADVANCED",
    advancingChoiceId:
      snapshot.acceptedA > snapshot.acceptedB ? snapshot.choiceAId : snapshot.choiceBId,
    advancingEntryId:
      snapshot.acceptedA > snapshot.acceptedB ? snapshot.entryAId : snapshot.entryBId,
    resultVersion: snapshot.resultVersion,
  };
}

export type TournamentRoundMatch = {
  bracketPosition: number;
  decision: TournamentMatchDecision;
};

export type TournamentProgress =
  | {
      status: "ROUND_BLOCKED";
      blockedPositions: number[];
    }
  | {
      status: "SERIES_COMPLETED";
      winnerEntryId: string;
    }
  | {
      status: "NEXT_ROUND_READY";
      roundNumber: number;
      matches: Array<{
        generationKey: string;
        bracketPosition: number;
        entryAId: string;
        entryBId: string;
      }>;
    };

export function planTournamentProgress(input: {
  seriesId: string;
  currentRoundNumber: number;
  matches: TournamentRoundMatch[];
}): TournamentProgress {
  if (!input.seriesId || input.currentRoundNumber < 1 || input.matches.length === 0) {
    throw new Error("Invalid Tournament round.");
  }

  const ordered = [...input.matches].sort(
    (left, right) => left.bracketPosition - right.bracketPosition,
  );
  const positions = ordered.map((match) => match.bracketPosition);
  if (
    new Set(positions).size !== positions.length ||
    positions.some((position, index) => position !== index + 1)
  ) {
    throw new Error("Tournament bracket positions must be unique and contiguous.");
  }

  const blockedPositions = ordered
    .filter((match) => match.decision.status !== "ADVANCED")
    .map((match) => match.bracketPosition);
  if (blockedPositions.length > 0) return { status: "ROUND_BLOCKED", blockedPositions };

  const advancingEntries = ordered.map((match) => {
    if (match.decision.status !== "ADVANCED") throw new Error("Unreachable match decision.");
    return match.decision.advancingEntryId;
  });
  if (advancingEntries.length === 1) {
    return { status: "SERIES_COMPLETED", winnerEntryId: advancingEntries[0]! };
  }
  if (advancingEntries.length % 2 !== 0) {
    throw new Error("The first Tournament scope requires a power-of-two bracket without byes.");
  }

  const roundNumber = input.currentRoundNumber + 1;
  return {
    status: "NEXT_ROUND_READY",
    roundNumber,
    matches: Array.from({ length: advancingEntries.length / 2 }, (_, index) => ({
      generationKey: `${input.seriesId}:round:${roundNumber}:match:${index + 1}`,
      bracketPosition: index + 1,
      entryAId: advancingEntries[index * 2]!,
      entryBId: advancingEntries[index * 2 + 1]!,
    })),
  };
}

export type PredictionStatus =
  "DRAFT" | "OPEN" | "CLOSED" | "RESOLUTION_PENDING" | "RESOLVED" | "VOID";

export type PredictionResolution = {
  status: "RESOLVED" | "VOID";
  revision: number;
  resolvedChoiceId: string | null;
  voidReason: string | null;
  sourceReference: string;
};

export function resolvePrediction(input: {
  currentStatus: PredictionStatus;
  currentRevision: number;
  choiceIds: string[];
  resolvedChoiceId?: string;
  voidReason?: string;
  sourceReference: string;
}): PredictionResolution {
  if (!["RESOLUTION_PENDING", "RESOLVED", "VOID"].includes(input.currentStatus)) {
    throw new Error("Prediction is not ready for resolution.");
  }
  if (input.choiceIds.length < 2 || new Set(input.choiceIds).size !== input.choiceIds.length) {
    throw new Error("Prediction choices must be unique.");
  }
  if (!input.sourceReference.trim()) throw new Error("Resolution evidence is required.");

  const hasResolvedChoice = input.resolvedChoiceId !== undefined;
  const hasVoidReason = Boolean(input.voidReason?.trim());
  if (hasResolvedChoice === hasVoidReason) {
    throw new Error("Resolve with exactly one Choice or one VOID reason.");
  }
  if (input.resolvedChoiceId && !input.choiceIds.includes(input.resolvedChoiceId)) {
    throw new Error("Resolved Choice does not belong to the Prediction.");
  }

  return {
    status: hasResolvedChoice ? "RESOLVED" : "VOID",
    revision: input.currentRevision + 1,
    resolvedChoiceId: input.resolvedChoiceId ?? null,
    voidReason: hasVoidReason ? input.voidReason!.trim() : null,
    sourceReference: input.sourceReference.trim(),
  };
}

export function derivePredictionOutcome(input: {
  resolution: PredictionResolution | null;
  votedChoiceId: string;
}): "PENDING" | "HIT" | "MISS" | "VOID" {
  if (!input.resolution) return "PENDING";
  if (input.resolution.status === "VOID") return "VOID";
  return input.resolution.resolvedChoiceId === input.votedChoiceId ? "HIT" : "MISS";
}

export const FUTURE_FORMAT_V2_GATES = {
  minimumStablePublicV0Days: 30,
  minimumPrototypeParticipants: 10,
  minimumTournamentDryRuns: 3,
  minimumPredictionResolutionFixtures: 30,
} as const;

export type FutureFormatV2Evidence = {
  format: "TOURNAMENT" | "PREDICTION";
  stablePublicV0Days: number;
  pickDecision: "PENDING" | "GO" | "NO_GO";
  prototypeParticipants: number;
  demandEvidenceDocumented: boolean;
  productCopyApproved: boolean;
  verticalPolicyApproved: boolean;
  firstPilotScope:
    | "LOW_RISK_ORIGINAL"
    | "SPORTS_WITH_LICENSED_DATA"
    | "POLITICS_OR_CURRENT_AFFAIRS"
    | "REAL_PERSON"
    | "FANDOM_IP_UNCLEARED";
  severeIncidentsInLast30Days: number;
  tournamentDryRuns: number;
  tournamentTransitionFailures: number;
  tournamentReplayMismatches: number;
  predictionResolutionFixtures: number;
  predictionAuditFailures: number;
  overduePredictionResolutions: number;
};

export type FutureFormatV2Reason =
  | "PUBLIC_V0_EVIDENCE_MISSING"
  | "PICK_DECISION_PENDING"
  | "PROTOTYPE_EVIDENCE_MISSING"
  | "FORMAT_DRY_RUN_EVIDENCE_MISSING"
  | "SEVERE_INCIDENT_OPEN"
  | "STATE_TRANSITION_FAILURE"
  | "IDEMPOTENCY_FAILURE"
  | "RESOLUTION_AUDIT_FAILURE"
  | "OVERDUE_RESOLUTION"
  | "PRODUCT_COPY_NOT_APPROVED"
  | "VERTICAL_POLICY_NOT_APPROVED"
  | "FIRST_PILOT_SCOPE_NOT_ALLOWED";

export function evaluateFutureFormatV2Gate(evidence: FutureFormatV2Evidence): {
  decision: "INSUFFICIENT_EVIDENCE" | "GO" | "NO_GO";
  reasons: FutureFormatV2Reason[];
} {
  const noGo: FutureFormatV2Reason[] = [];
  if (evidence.severeIncidentsInLast30Days > 0) noGo.push("SEVERE_INCIDENT_OPEN");
  if (evidence.tournamentTransitionFailures > 0) noGo.push("STATE_TRANSITION_FAILURE");
  if (evidence.tournamentReplayMismatches > 0) noGo.push("IDEMPOTENCY_FAILURE");
  if (evidence.predictionAuditFailures > 0) noGo.push("RESOLUTION_AUDIT_FAILURE");
  if (evidence.overduePredictionResolutions > 0) noGo.push("OVERDUE_RESOLUTION");
  if (!evidence.productCopyApproved) noGo.push("PRODUCT_COPY_NOT_APPROVED");
  if (!evidence.verticalPolicyApproved) noGo.push("VERTICAL_POLICY_NOT_APPROVED");
  if (!["LOW_RISK_ORIGINAL", "SPORTS_WITH_LICENSED_DATA"].includes(evidence.firstPilotScope)) {
    noGo.push("FIRST_PILOT_SCOPE_NOT_ALLOWED");
  }
  if (noGo.length > 0) return { decision: "NO_GO", reasons: noGo };

  const insufficient: FutureFormatV2Reason[] = [];
  if (evidence.stablePublicV0Days < FUTURE_FORMAT_V2_GATES.minimumStablePublicV0Days) {
    insufficient.push("PUBLIC_V0_EVIDENCE_MISSING");
  }
  if (evidence.pickDecision === "PENDING") insufficient.push("PICK_DECISION_PENDING");
  if (
    evidence.prototypeParticipants < FUTURE_FORMAT_V2_GATES.minimumPrototypeParticipants ||
    !evidence.demandEvidenceDocumented
  ) {
    insufficient.push("PROTOTYPE_EVIDENCE_MISSING");
  }
  if (
    (evidence.format === "TOURNAMENT" &&
      evidence.tournamentDryRuns < FUTURE_FORMAT_V2_GATES.minimumTournamentDryRuns) ||
    (evidence.format === "PREDICTION" &&
      evidence.predictionResolutionFixtures <
        FUTURE_FORMAT_V2_GATES.minimumPredictionResolutionFixtures)
  ) {
    insufficient.push("FORMAT_DRY_RUN_EVIDENCE_MISSING");
  }
  if (insufficient.length > 0) return { decision: "INSUFFICIENT_EVIDENCE", reasons: insufficient };
  return { decision: "GO", reasons: [] };
}
