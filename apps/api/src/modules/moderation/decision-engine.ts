import { createHash } from "node:crypto";

import {
  DETERMINISTIC_PRIVATE_REJECT_REASONS,
  MODERATION_POLICY_VERSION,
  MODERATION_REASON_CODES,
  getModerationActionPolicy,
  getModerationReason,
  resolveModerationAuthority,
  type CanonicalModerationAction,
  type ModerationContentKind,
  type ModerationContextState,
  type ModerationReasonCode,
  type ModerationSource,
} from "./policy-registry.js";
import {
  MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
  findModerationDecisionThreshold,
  type AutomatedModerationAction,
  type ModerationDecisionModality,
} from "./decision-threshold-registry.js";

export const MODERATION_DECISION_ENGINE_VERSION = "which-decision-engine-v1" as const;

export const MODERATION_DOMAIN_ACTIONS = [
  "ALLOW",
  "NUDGE",
  "LIMIT",
  "PRIVATE_PENDING",
  "QUARANTINE",
  "BLOCK",
  "PROVISIONAL",
] as const;
export type ModerationDomainAction = (typeof MODERATION_DOMAIN_ACTIONS)[number];

export const MODERATION_DOMAIN_ACTION_MAP = {
  ALLOW: "PUBLISHED",
  NUDGE: "REVIEW",
  LIMIT: "REVIEW",
  PRIVATE_PENDING: "REVIEW",
  QUARANTINE: "QUARANTINED",
  BLOCK: "PRIVATE_REJECT",
  PROVISIONAL: "PROVISIONAL",
} as const satisfies Readonly<Record<ModerationDomainAction, CanonicalModerationAction>>;

export const MODERATION_AUTOMATION_REJECTION_CODES = [
  "ENGINE_DISABLED",
  "GLOBAL_KILL_SWITCH_ENABLED",
  "CATEGORY_DISABLED",
  "UNKNOWN_REASON",
  "UNSUPPORTED_LABEL",
  "STALE_POLICY_VERSION",
  "STALE_THRESHOLD_REGISTRY",
  "THRESHOLD_NOT_REGISTERED",
  "MISSING_SIGNAL",
  "INVALID_EVIDENCE",
  "INSUFFICIENT_CONTEXT",
  "PROVIDER_FAILURE",
  "PROVIDER_ABSTAINED",
  "MODEL_DISAGREEMENT",
  "BELOW_REVIEW_THRESHOLD",
  "ABSTAIN_THRESHOLD_BAND",
  "INSUFFICIENT_EVIDENCE",
  "SOURCE_NOT_AUTHORIZED",
  "HUMAN_ONLY_DECISION",
  "OPERATIONAL_BUDGET_UNHEALTHY",
  "OUTSIDE_CANARY",
  "PROVISIONAL_RELEASE_NOT_APPROVED",
  "PROVISIONAL_COHORT_NOT_ALLOWED",
  "PROVISIONAL_ASSET_TYPE_NOT_ALLOWED",
] as const;
export type ModerationAutomationRejectionCode =
  (typeof MODERATION_AUTOMATION_REJECTION_CODES)[number];

export type ModerationDecisionSignal = {
  label: string;
  score: number;
  source: ModerationSource;
  modality: ModerationDecisionModality;
  policyVersion: string;
  sourceVersion: string;
  evidenceCount: number;
  evidenceValid: boolean;
  supported: boolean;
};

export type ModerationDecisionRuntime = {
  mode: "OFF" | "SHADOW" | "REVIEW_ASSIST" | "LIMITED_ACTION";
  killSwitch: boolean;
  canaryPercent: number;
  categoryFlags: Readonly<Record<string, boolean>>;
  operationalBudgetHealthy: boolean;
  provisionalReleaseApproved: boolean;
  provisionalCohorts: readonly string[];
  provisionalAssetTypes: readonly string[];
  quarantineTtlSeconds: number;
  provisionalTtlSeconds: number;
};

export type ModerationDecisionRequest = {
  policyVersion: string;
  thresholdRegistryVersion: string;
  requestedAction: ModerationDomainAction;
  reasonCode: string;
  contentKind: ModerationContentKind;
  modality: ModerationDecisionModality;
  slice: string;
  category: string;
  source: ModerationSource;
  contextState: ModerationContextState;
  providerStatus: "NOT_REQUIRED" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  providerAbstained?: boolean;
  modelAgreement?: boolean;
  signals: readonly ModerationDecisionSignal[];
  normalizedInputHash: string;
  cohort?: string;
  assetType?: string;
  humanOnlyDecision?: boolean;
  previousAction?: ModerationDomainAction;
  evaluatedAt?: Date;
};

export type ModerationDecisionResult = {
  schemaVersion: 1;
  engineVersion: typeof MODERATION_DECISION_ENGINE_VERSION;
  policyVersion: string;
  thresholdRegistryVersion: string;
  outcome: "EXECUTE" | "REVIEW";
  action: ModerationDomainAction;
  canonicalAction: CanonicalModerationAction;
  rejectionCodes: ModerationAutomationRejectionCode[];
  reversible: boolean;
  expiresAt: string | null;
  automaticExpiryAction: ModerationDomainAction | null;
  rollbackAction: ModerationDomainAction | null;
};

const knownReasons = new Set<string>(MODERATION_REASON_CODES);
const deterministicReasons = new Set<string>(DETERMINISTIC_PRIVATE_REJECT_REASONS);

function fallback(input: ModerationDecisionRequest, codes: ModerationAutomationRejectionCode[]) {
  const action = "PRIVATE_PENDING" as const;
  return {
    schemaVersion: 1,
    engineVersion: MODERATION_DECISION_ENGINE_VERSION,
    policyVersion: input.policyVersion,
    thresholdRegistryVersion: input.thresholdRegistryVersion,
    outcome: "REVIEW",
    action,
    canonicalAction: MODERATION_DOMAIN_ACTION_MAP[action],
    rejectionCodes: [...new Set(codes)],
    reversible: true,
    expiresAt: null,
    automaticExpiryAction: null,
    rollbackAction: null,
  } satisfies ModerationDecisionResult;
}

function canaryAllowed(hash: string, percent: number) {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const digest = createHash("sha256").update(hash).digest().readUInt32BE(0);
  return (digest / 0xffffffff) * 100 < percent;
}

function automationAction(action: ModerationDomainAction): AutomatedModerationAction | null {
  return action === "BLOCK" || action === "QUARANTINE" || action === "PROVISIONAL" ? action : null;
}

export function evaluateModerationDecision(input: {
  request: ModerationDecisionRequest;
  runtime: ModerationDecisionRuntime;
}): ModerationDecisionResult {
  const { request, runtime } = input;
  const rejectionCodes: ModerationAutomationRejectionCode[] = [];
  if (runtime.mode !== "LIMITED_ACTION") rejectionCodes.push("ENGINE_DISABLED");
  if (runtime.killSwitch) rejectionCodes.push("GLOBAL_KILL_SWITCH_ENABLED");
  if (runtime.categoryFlags[request.category] !== true) rejectionCodes.push("CATEGORY_DISABLED");
  if (request.policyVersion !== MODERATION_POLICY_VERSION) {
    rejectionCodes.push("STALE_POLICY_VERSION");
  }
  if (request.thresholdRegistryVersion !== MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION) {
    rejectionCodes.push("STALE_THRESHOLD_REGISTRY");
  }
  if (!knownReasons.has(request.reasonCode)) rejectionCodes.push("UNKNOWN_REASON");
  if (request.humanOnlyDecision) rejectionCodes.push("HUMAN_ONLY_DECISION");
  if (!runtime.operationalBudgetHealthy) rejectionCodes.push("OPERATIONAL_BUDGET_UNHEALTHY");
  if (!canaryAllowed(request.normalizedInputHash, runtime.canaryPercent)) {
    rejectionCodes.push("OUTSIDE_CANARY");
  }
  if (request.source === "MODEL" && request.providerStatus !== "SUCCEEDED") {
    rejectionCodes.push("PROVIDER_FAILURE");
  }
  if (request.providerAbstained) rejectionCodes.push("PROVIDER_ABSTAINED");
  if (request.modelAgreement === false) rejectionCodes.push("MODEL_DISAGREEMENT");
  if (rejectionCodes.length > 0 || !knownReasons.has(request.reasonCode)) {
    return fallback(request, rejectionCodes);
  }

  const reasonCode = request.reasonCode as ModerationReasonCode;
  const reason = getModerationReason(reasonCode);
  if (!reason.targets.includes(request.contentKind)) rejectionCodes.push("UNSUPPORTED_LABEL");
  if (reason.requiresContext && request.contextState !== "SUFFICIENT") {
    rejectionCodes.push("INSUFFICIENT_CONTEXT");
  }
  const matchingSignals = request.signals.filter(
    (signal) => signal.label === reasonCode && signal.source === request.source,
  );
  if (matchingSignals.length === 0) rejectionCodes.push("MISSING_SIGNAL");
  if (matchingSignals.some((signal) => !signal.supported)) rejectionCodes.push("UNSUPPORTED_LABEL");
  if (
    matchingSignals.some(
      (signal) =>
        signal.policyVersion !== request.policyVersion || signal.modality !== request.modality,
    )
  ) {
    rejectionCodes.push("STALE_POLICY_VERSION");
  }
  if (
    matchingSignals.some(
      (signal) =>
        !signal.evidenceValid ||
        !signal.sourceVersion ||
        !Number.isFinite(signal.score) ||
        signal.score < 0 ||
        signal.score > 1 ||
        !Number.isInteger(signal.evidenceCount) ||
        signal.evidenceCount < 0,
    )
  ) {
    rejectionCodes.push("INVALID_EVIDENCE");
  }

  const requestedAutomationAction = automationAction(request.requestedAction);
  if (!requestedAutomationAction) return fallback(request, ["SOURCE_NOT_AUTHORIZED"]);
  const threshold = findModerationDecisionThreshold({
    registryVersion: request.thresholdRegistryVersion,
    policyVersion: request.policyVersion,
    label: reasonCode,
    action: requestedAutomationAction,
    modality: request.modality,
    slice: request.slice,
  });
  if (!threshold) rejectionCodes.push("THRESHOLD_NOT_REGISTERED");
  if (threshold && matchingSignals.length > 0) {
    const maximumScore = Math.max(...matchingSignals.map((signal) => signal.score));
    const evidenceCount = matchingSignals.reduce((sum, signal) => sum + signal.evidenceCount, 0);
    if (maximumScore < threshold.reviewThreshold) {
      rejectionCodes.push("BELOW_REVIEW_THRESHOLD");
    } else if (maximumScore < threshold.actionThreshold) {
      rejectionCodes.push("ABSTAIN_THRESHOLD_BAND");
    }
    if (evidenceCount < threshold.minimumEvidenceCount) {
      rejectionCodes.push("INSUFFICIENT_EVIDENCE");
    }
  }

  if (request.requestedAction === "BLOCK") {
    if (request.source !== "RULE" || !deterministicReasons.has(reasonCode)) {
      rejectionCodes.push("SOURCE_NOT_AUTHORIZED");
    }
  }
  const canonicalAction = MODERATION_DOMAIN_ACTION_MAP[request.requestedAction];
  const authority = resolveModerationAuthority({
    source: request.source,
    action: canonicalAction,
    reasonCode,
    contextState: request.contextState,
    releaseGateEnabled: true,
  });
  if (!authority.allowed) rejectionCodes.push("SOURCE_NOT_AUTHORIZED");

  if (request.requestedAction === "PROVISIONAL") {
    if (!runtime.provisionalReleaseApproved) {
      rejectionCodes.push("PROVISIONAL_RELEASE_NOT_APPROVED");
    }
    if (!request.cohort || !runtime.provisionalCohorts.includes(request.cohort)) {
      rejectionCodes.push("PROVISIONAL_COHORT_NOT_ALLOWED");
    }
    if (!request.assetType || !runtime.provisionalAssetTypes.includes(request.assetType)) {
      rejectionCodes.push("PROVISIONAL_ASSET_TYPE_NOT_ALLOWED");
    }
    if (request.modelAgreement !== true) rejectionCodes.push("MODEL_DISAGREEMENT");
  }
  if (rejectionCodes.length > 0) return fallback(request, rejectionCodes);

  const evaluatedAt = request.evaluatedAt ?? new Date();
  const ttlSeconds =
    request.requestedAction === "QUARANTINE"
      ? runtime.quarantineTtlSeconds
      : request.requestedAction === "PROVISIONAL"
        ? runtime.provisionalTtlSeconds
        : 0;
  const previousAction = request.previousAction ?? "PRIVATE_PENDING";
  const expiryAction =
    request.requestedAction === "QUARANTINE"
      ? previousAction
      : request.requestedAction === "PROVISIONAL"
        ? "PRIVATE_PENDING"
        : null;
  const actionPolicy = getModerationActionPolicy(canonicalAction);
  return {
    schemaVersion: 1,
    engineVersion: MODERATION_DECISION_ENGINE_VERSION,
    policyVersion: request.policyVersion,
    thresholdRegistryVersion: request.thresholdRegistryVersion,
    outcome: "EXECUTE",
    action: request.requestedAction,
    canonicalAction,
    rejectionCodes: [],
    reversible: actionPolicy.reversible,
    expiresAt:
      ttlSeconds > 0 ? new Date(evaluatedAt.getTime() + ttlSeconds * 1000).toISOString() : null,
    automaticExpiryAction: expiryAction,
    rollbackAction: expiryAction,
  };
}

export function rollbackModerationDecision(
  decision: ModerationDecisionResult,
): ModerationDomainAction | null {
  return decision.outcome === "EXECUTE" && decision.reversible ? decision.rollbackAction : null;
}
