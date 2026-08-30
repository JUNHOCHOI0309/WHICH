import type { ModerationProviderSignal } from "./contracts.js";

export const OPENAI_COVERAGE_VERSION = "omni-moderation-2024-09-26-coverage-v1";
// Official endpoint coverage, not an inference from a zero score. Text-only categories
// must never be promoted to image coverage just because an image accompanied the text.
export const OPENAI_IMAGE_LABELS = [
  "self-harm",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual",
  "violence",
  "violence/graphic",
] as const;
export const OPENAI_TEXT_ONLY_LABELS = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "sexual/minors",
] as const;
export const OPENAI_TEXT_LABELS = [...OPENAI_IMAGE_LABELS, ...OPENAI_TEXT_ONLY_LABELS];

export function openAiCoverage(signals: readonly ModerationProviderSignal[]) {
  const observed = (labels: readonly string[], modality: "TEXT" | "IMAGE") =>
    labels.filter((label) =>
      signals.some(
        (signal) => signal.providerLabel === label && signal.appliedModalities.includes(modality),
      ),
    );
  const imageLabels = observed(OPENAI_IMAGE_LABELS, "IMAGE");
  const textLabels = observed(OPENAI_TEXT_LABELS, "TEXT");
  return {
    version: OPENAI_COVERAGE_VERSION,
    imageLabels,
    textLabels,
    missingImageLabels: OPENAI_IMAGE_LABELS.filter((label) => !imageLabels.includes(label)),
    missingTextLabels: OPENAI_TEXT_LABELS.filter((label) => !textLabels.includes(label)),
    imageUnsupportedLabels: [...OPENAI_TEXT_ONLY_LABELS],
    localVisualChecksSupported: false as const,
    calibratedClearDecisionSupported: false as const,
  };
}
