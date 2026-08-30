import type { ModerationTargetType } from "../moderation-dispatch/contracts.js";
import type { EmbeddedTextEvidence } from "../issue-media/embedded-text.js";

export const MODERATION_PROVIDER_RESULT_SCHEMA_VERSION = 1;
// Bump whenever minimized provider inputs change. Older image caches included live context.
export const MODERATION_PROVIDER_INPUT_VERSION = "which-provider-input-v2";

export type ModerationProviderModality = "TEXT" | "IMAGE" | "TEXT_AND_IMAGE";
export type ModerationCalibratedBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ModerationProviderFailureKind =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "REFUSAL"
  | "MALFORMED_OUTPUT"
  | "AUTHENTICATION"
  | "PROVIDER_UNAVAILABLE"
  | "INPUT_UNAVAILABLE";

export type ModerationProviderInput = {
  targetType: ModerationTargetType;
  modality: ModerationProviderModality;
  text?: string;
  embeddedText?: EmbeddedTextEvidence;
  image?: {
    dataUrl: string;
    mimeType: "image/webp";
    width: number;
    height: number;
    byteLength: number;
    metadataStripped: true;
    reencoded: true;
  };
  // Images are ordered A then B for a submission; an asset-only target has one image.
  images?: Array<NonNullable<ModerationProviderInput["image"]>>;
  scope?: "COMMENT_REVISION" | "ISSUE_SNAPSHOT" | "SUBMISSION_REVISION" | "ASSET_ONLY";
  context?: {
    question?: string;
    choices?: string[];
    altText?: string;
    piiRedacted: true;
  };
};

export type ModerationProviderSignal = {
  providerLabel: string;
  canonicalCode: string;
  rawScore: number;
  calibratedBand: ModerationCalibratedBand;
  flagged: boolean;
  appliedModalities: Array<"TEXT" | "IMAGE">;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
};

export type NormalizedModerationProviderResult = {
  schemaVersion: typeof MODERATION_PROVIDER_RESULT_SCHEMA_VERSION;
  provider: string;
  modality: ModerationProviderModality;
  modelSnapshot: string;
  supportedLabels: string[];
  unsupportedLabels: string[];
  signals: ModerationProviderSignal[];
  abstained: boolean;
  providerDisagreement: boolean | null;
  capabilities: { boundingBoxes: boolean };
  publicationChanged: false;
};

export class ModerationProviderCallError extends Error {
  constructor(
    readonly kind: ModerationProviderFailureKind,
    readonly code: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(`${kind}:${code}`);
    this.name = "ModerationProviderCallError";
  }
}

export function calibratedBand(score: number): ModerationCalibratedBand {
  if (score >= 0.9) return "CRITICAL";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.35) return "MEDIUM";
  return "LOW";
}
