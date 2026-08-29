import {
  MODERATION_REASON_CODES,
  type CanonicalModerationAction,
  type ModerationReasonCode,
} from "../moderation/policy-registry.js";
import type { NormalizedModerationProviderResult } from "./contracts.js";

const reasonCodes = new Set<string>(MODERATION_REASON_CODES);

export function compareModerationProviders(
  left: NormalizedModerationProviderResult,
  right: NormalizedModerationProviderResult,
) {
  const flagged = (result: NormalizedModerationProviderResult) =>
    new Set(
      result.signals.filter((signal) => signal.flagged).map((signal) => signal.canonicalCode),
    );
  const leftFlags = flagged(left);
  const rightFlags = flagged(right);
  return {
    disagreed:
      leftFlags.size !== rightFlags.size || [...leftFlags].some((code) => !rightFlags.has(code)),
    leftFlags: [...leftFlags].sort(),
    rightFlags: [...rightFlags].sort(),
  };
}

export function toGoldenSetPrediction(input: {
  caseId: string;
  result: NormalizedModerationProviderResult;
  latencyMs: number;
  costMicros: number;
  reviewerAction?: CanonicalModerationAction;
}) {
  const actionable = input.result.signals.filter(
    (signal) =>
      signal.flagged || signal.calibratedBand === "HIGH" || signal.calibratedBand === "CRITICAL",
  );
  const reasons = [
    ...new Set(
      actionable
        .map(({ canonicalCode }) => canonicalCode)
        .filter((code): code is ModerationReasonCode => reasonCodes.has(code)),
    ),
  ];
  const confidence = Math.max(0, ...input.result.signals.map(({ rawScore }) => rawScore));
  const abstained = input.result.abstained || input.result.signals.length === 0;
  return {
    caseId: input.caseId,
    predictedAction: abstained
      ? null
      : actionable.length > 0
        ? ("REVIEW" as const)
        : ("PUBLISHED" as const),
    reasonCodes: abstained ? [] : reasons.length > 0 ? reasons : ["NO_POLICY_VIOLATION" as const],
    abstained,
    confidence,
    ...(input.reviewerAction ? { reviewerAction: input.reviewerAction } : {}),
    latencyMs: input.latencyMs,
    costMicros: input.costMicros,
  };
}

export type ModerationDriftSnapshot = {
  modelSnapshot: string;
  sampleSize: number;
  flaggedRate: number;
  meanMaxScore: number;
};

export function detectModerationDrift(input: {
  baseline: ModerationDriftSnapshot;
  current: ModerationDriftSnapshot;
  maximumFlaggedRateDelta?: number;
  maximumMeanScoreDelta?: number;
}) {
  const flaggedRateDelta = input.current.flaggedRate - input.baseline.flaggedRate;
  const meanScoreDelta = input.current.meanMaxScore - input.baseline.meanMaxScore;
  const modelChanged = input.current.modelSnapshot !== input.baseline.modelSnapshot;
  const drifted =
    modelChanged ||
    Math.abs(flaggedRateDelta) > (input.maximumFlaggedRateDelta ?? 0.05) ||
    Math.abs(meanScoreDelta) > (input.maximumMeanScoreDelta ?? 0.08);
  return { drifted, modelChanged, flaggedRateDelta, meanScoreDelta };
}
