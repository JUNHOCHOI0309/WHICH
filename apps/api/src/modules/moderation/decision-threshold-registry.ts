import type { ModerationReasonCode } from "./policy-registry.js";

export const MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION =
  "which-decision-thresholds-v1" as const;

export const MODERATION_DECISION_MODALITIES = ["TEXT", "IMAGE", "TEXT_AND_IMAGE"] as const;
export type ModerationDecisionModality = (typeof MODERATION_DECISION_MODALITIES)[number];

export const AUTOMATED_MODERATION_ACTIONS = ["BLOCK", "QUARANTINE", "PROVISIONAL"] as const;
export type AutomatedModerationAction = (typeof AUTOMATED_MODERATION_ACTIONS)[number];

export type ModerationDecisionThreshold = {
  registryVersion: typeof MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION;
  policyVersion: string;
  label: ModerationReasonCode;
  action: AutomatedModerationAction;
  modality: ModerationDecisionModality;
  slice: string;
  reviewThreshold: number;
  actionThreshold: number;
  minimumEvidenceCount: number;
};

const threshold = (
  entry: Omit<ModerationDecisionThreshold, "registryVersion" | "policyVersion">,
): ModerationDecisionThreshold => ({
  registryVersion: MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
  policyVersion: "1.0.0",
  ...entry,
});

export const MODERATION_DECISION_THRESHOLDS = [
  threshold({
    label: "TECHNICAL_DECODE_FAILED",
    action: "BLOCK",
    modality: "IMAGE",
    slice: "TECHNICAL",
    reviewThreshold: 1,
    actionThreshold: 1,
    minimumEvidenceCount: 1,
  }),
  threshold({
    label: "TECHNICAL_PROHIBITED_FORMAT",
    action: "BLOCK",
    modality: "IMAGE",
    slice: "TECHNICAL",
    reviewThreshold: 1,
    actionThreshold: 1,
    minimumEvidenceCount: 1,
  }),
  threshold({
    label: "TECHNICAL_KNOWN_BLOCK_EXACT_HASH",
    action: "BLOCK",
    modality: "IMAGE",
    slice: "TECHNICAL",
    reviewThreshold: 1,
    actionThreshold: 1,
    minimumEvidenceCount: 1,
  }),
  threshold({
    label: "THREAT",
    action: "QUARANTINE",
    modality: "TEXT_AND_IMAGE",
    slice: "DEFAULT",
    reviewThreshold: 0.7,
    actionThreshold: 0.98,
    minimumEvidenceCount: 2,
  }),
  threshold({
    label: "CONTENT_GRAPHIC_VIOLENCE",
    action: "QUARANTINE",
    modality: "IMAGE",
    slice: "IMAGE_VIOLENCE",
    reviewThreshold: 0.7,
    actionThreshold: 0.98,
    minimumEvidenceCount: 2,
  }),
  threshold({
    label: "CONTENT_SEXUAL_EXPLOITATION",
    action: "QUARANTINE",
    modality: "IMAGE",
    slice: "IMAGE_SEXUAL_RISK",
    reviewThreshold: 0.7,
    actionThreshold: 0.995,
    minimumEvidenceCount: 2,
  }),
  threshold({
    label: "PRIVACY_PII_DETECTED",
    action: "QUARANTINE",
    modality: "IMAGE",
    slice: "IMAGE_PII",
    reviewThreshold: 0.7,
    actionThreshold: 0.99,
    minimumEvidenceCount: 2,
  }),
  threshold({
    label: "NO_POLICY_VIOLATION",
    action: "PROVISIONAL",
    modality: "IMAGE",
    slice: "LOW_RISK_ISSUE_MEDIA",
    reviewThreshold: 0.95,
    actionThreshold: 0.995,
    minimumEvidenceCount: 2,
  }),
] as const satisfies readonly ModerationDecisionThreshold[];

export function findModerationDecisionThreshold(input: {
  registryVersion: string;
  policyVersion: string;
  label: ModerationReasonCode;
  action: AutomatedModerationAction;
  modality: ModerationDecisionModality;
  slice: string;
}): ModerationDecisionThreshold | null {
  if (input.registryVersion !== MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION) return null;
  return (
    MODERATION_DECISION_THRESHOLDS.find(
      (entry) =>
        entry.registryVersion === input.registryVersion &&
        entry.policyVersion === input.policyVersion &&
        entry.label === input.label &&
        entry.action === input.action &&
        entry.modality === input.modality &&
        entry.slice === input.slice,
    ) ?? null
  );
}
