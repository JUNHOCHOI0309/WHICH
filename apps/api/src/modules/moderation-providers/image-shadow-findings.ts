import { z } from "zod";

import type { NormalizedModerationProviderResult } from "./contracts.js";
import { openAiCoverage } from "./openai-coverage.js";
import { embeddedTextEvidenceSchema } from "../issue-media/embedded-text.js";

export const normalizedResultSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.string().min(1),
  modality: z.enum(["TEXT", "IMAGE", "TEXT_AND_IMAGE"]),
  modelSnapshot: z.string().min(1),
  supportedLabels: z.array(z.string()),
  unsupportedLabels: z.array(z.string()),
  signals: z.array(
    z.object({
      providerLabel: z.string().min(1),
      canonicalCode: z.string().min(1),
      rawScore: z.number().min(0).max(1),
      calibratedBand: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      flagged: z.boolean(),
      appliedModalities: z.array(z.enum(["TEXT", "IMAGE"])),
      regions: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
      ),
    }),
  ),
  abstained: z.boolean(),
  providerDisagreement: z.boolean().nullable(),
  capabilities: z.object({ boundingBoxes: z.boolean() }),
  publicationChanged: z.literal(false),
});

export type ImageProviderShadowFinding = {
  stage: "PROVIDER_SHADOW";
  code: string;
  severity: "INFO" | "REVIEW";
  sourceVersion: string;
  evidence: Record<string, unknown>;
};

function sourceVersion(result: NormalizedModerationProviderResult) {
  return `${result.provider}:${result.modelSnapshot}`.slice(0, 64);
}

function findingCode(canonicalCode: string) {
  return `MEDIA_AI_${canonicalCode.replace(/[^A-Z0-9_]/gu, "_")}`.slice(0, 64);
}

export function toImageProviderShadowFindings(input: {
  result: Record<string, unknown>;
  policyVersion: string;
  cacheHit: boolean;
}): ImageProviderShadowFinding[] {
  const parsed = normalizedResultSchema.safeParse(input.result);
  if (!parsed.success || !["IMAGE", "TEXT_AND_IMAGE"].includes(parsed.data.modality)) return [];

  const result: NormalizedModerationProviderResult = parsed.data;
  const version = sourceVersion(result);
  const embedded = embeddedTextEvidenceSchema.safeParse(input.result.embeddedText);
  const commonEvidence = {
    schemaVersion: result.schemaVersion,
    provider: result.provider,
    modelSnapshot: result.modelSnapshot,
    modality: result.modality,
    policyVersion: input.policyVersion,
    cacheHit: input.cacheHit,
    publicationChanged: false,
  };
  const findings: ImageProviderShadowFinding[] = result.signals.map((signal) => ({
    stage: "PROVIDER_SHADOW",
    code: findingCode(signal.canonicalCode),
    severity:
      signal.flagged || signal.calibratedBand === "HIGH" || signal.calibratedBand === "CRITICAL"
        ? "REVIEW"
        : "INFO",
    sourceVersion: version,
    evidence: {
      ...commonEvidence,
      providerLabel: signal.providerLabel,
      canonicalCode: signal.canonicalCode,
      score: signal.rawScore,
      calibratedBand: signal.calibratedBand,
      flagged: signal.flagged,
      appliedModalities: signal.appliedModalities,
      regions: signal.regions,
      boundingBoxesSupported: result.capabilities.boundingBoxes,
    },
  }));

  findings.push({
    stage: "PROVIDER_SHADOW",
    code: "MEDIA_AI_PROVIDER_CAPABILITIES",
    severity: "INFO",
    sourceVersion: version,
    evidence: {
      ...commonEvidence,
      supportedLabels: result.supportedLabels,
      unsupportedLabels: result.unsupportedLabels,
      boundingBoxesSupported: result.capabilities.boundingBoxes,
      relevanceSupported: !result.unsupportedLabels.includes("ISSUE_RELEVANCE"),
      visualFairnessSupported: !result.unsupportedLabels.includes("VISUAL_FAIRNESS"),
      embeddedText: embedded.success ? embedded.data : null,
      modalityCoverage:
        result.provider === "OPENAI_MODERATION" &&
        result.modelSnapshot === "omni-moderation-2024-09-26"
          ? openAiCoverage(result.signals)
          : null,
    },
  });

  if (result.abstained) {
    findings.push({
      stage: "PROVIDER_SHADOW",
      code: "MEDIA_AI_PROVIDER_ABSTAINED",
      severity: "REVIEW",
      sourceVersion: version,
      evidence: commonEvidence,
    });
  }
  if (result.providerDisagreement) {
    findings.push({
      stage: "PROVIDER_SHADOW",
      code: "MEDIA_AI_PROVIDER_DISAGREEMENT",
      severity: "REVIEW",
      sourceVersion: version,
      evidence: commonEvidence,
    });
  }
  return findings;
}
