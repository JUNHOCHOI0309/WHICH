import { z } from "zod";

import {
  CANONICAL_MODERATION_ACTIONS,
  MODERATION_CONTENT_KINDS,
  MODERATION_REASON_CODES,
} from "../moderation/policy-registry.js";

export const MODERATION_EVALUATION_SCHEMA_VERSION = 1 as const;

export const MODERATION_EVALUATION_MODALITIES = ["TEXT", "IMAGE", "MULTIMODAL"] as const;
export type ModerationEvaluationModality = (typeof MODERATION_EVALUATION_MODALITIES)[number];

export const MODERATION_EVALUATION_COHORTS = [
  "SMOKE",
  "ZERO_CRITICAL_REFERENCE",
  "PROVISIONAL_AUDIT",
] as const;

export const REQUIRED_MODERATION_EVALUATION_SLICES = {
  TEXT: [
    "TEXT_NORMAL_DISAGREEMENT",
    "TEXT_FRIENDLY_PROFANITY",
    "TEXT_HATE",
    "TEXT_THREAT",
    "TEXT_PII",
    "TEXT_SPAM",
    "TEXT_SATIRE",
    "TEXT_QUOTATION",
    "TEXT_OBFUSCATED_KOREAN",
  ],
  IMAGE: [
    "IMAGE_FOOD",
    "IMAGE_LANDSCAPE",
    "IMAGE_ILLUSTRATION",
    "IMAGE_ANIME",
    "IMAGE_SKIN_EXPOSURE_FALSE_POSITIVE",
    "IMAGE_PII",
    "IMAGE_QR",
    "IMAGE_DOCUMENT",
    "IMAGE_SCREENSHOT",
    "IMAGE_VIOLENCE",
    "IMAGE_SEXUAL_RISK",
    "IMAGE_NEWS_POLITICS",
    "IMAGE_LOW_LIGHT",
  ],
  MULTIMODAL: [
    "MULTIMODAL_QUESTION_RELEVANCE",
    "MULTIMODAL_MISLEADING_CONTEXT",
    "MULTIMODAL_AB_INFORMATION_ASYMMETRY",
    "MULTIMODAL_CROP_ASYMMETRY",
    "MULTIMODAL_SALIENCE_ASYMMETRY",
  ],
} as const satisfies Readonly<Record<ModerationEvaluationModality, readonly string[]>>;

const privateReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/^(?:https?:|data:)/iu.test(value), "Only private references are allowed.");

export const moderationGoldenVerdictSchema = z.object({
  action: z.enum(CANONICAL_MODERATION_ACTIONS),
  reasonCodes: z.array(z.enum(MODERATION_REASON_CODES)).min(1),
  critical: z.boolean(),
});

export type ModerationGoldenVerdict = z.infer<typeof moderationGoldenVerdictSchema>;

export const moderationHumanWorkflowSchema = z.object({
  type: z.enum(["RIGHTS_OWNERSHIP", "DEFAMATION_VERACITY"]),
  outcome: z.enum(["PENDING", "CLEARED", "UPHELD", "WITHDRAWN"]),
  caseReference: privateReferenceSchema,
});

const moderationReviewSchema = z
  .object({
    reviewerId: z.string().min(3).max(64),
    reviewedAt: z.string().datetime(),
    verdict: moderationGoldenVerdictSchema.nullable().default(null),
    humanWorkflow: moderationHumanWorkflowSchema.nullable().default(null),
  })
  .superRefine((review, context) => {
    if ((review.verdict === null) === (review.humanWorkflow === null)) {
      context.addIssue({
        code: "custom",
        message: "A review must contain exactly one model verdict or human workflow outcome.",
      });
    }
  });

export const moderationGoldenCaseSchema = z
  .object({
    caseId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,95}$/u),
    modality: z.enum(MODERATION_EVALUATION_MODALITIES),
    contentKind: z.enum(MODERATION_CONTENT_KINDS),
    cohort: z.enum(MODERATION_EVALUATION_COHORTS).default("SMOKE"),
    slices: z.array(z.string().min(3).max(96)).min(1),
    privateReference: privateReferenceSchema,
    syntheticSummary: z.string().min(5).max(500),
    reviews: z.array(moderationReviewSchema).length(2),
    adjudication: moderationReviewSchema.optional(),
  })
  .superRefine((goldenCase, context) => {
    if (goldenCase.reviews[0]?.reviewerId === goldenCase.reviews[1]?.reviewerId) {
      context.addIssue({ code: "custom", message: "Release-gate reviews must be independent." });
    }
    if (
      goldenCase.adjudication &&
      goldenCase.reviews.some((review) => review.reviewerId === goldenCase.adjudication?.reviewerId)
    ) {
      context.addIssue({ code: "custom", message: "Adjudication requires a third reviewer." });
    }
    const wrongSlice = goldenCase.slices.find(
      (slice) => !slice.startsWith(`${goldenCase.modality}_`),
    );
    if (wrongSlice) {
      context.addIssue({
        code: "custom",
        message: `Slice ${wrongSlice} does not match modality ${goldenCase.modality}.`,
      });
    }
  });

export type ModerationGoldenCase = z.infer<typeof moderationGoldenCaseSchema>;

export const moderationGoldenDatasetSchema = z
  .object({
    schemaVersion: z.literal(MODERATION_EVALUATION_SCHEMA_VERSION),
    datasetId: z.string().min(3).max(96),
    datasetVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    createdAt: z.string().datetime(),
    cases: z.array(moderationGoldenCaseSchema).min(1),
  })
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    for (const [index, goldenCase] of dataset.cases.entries()) {
      if (ids.has(goldenCase.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: `Duplicate Case ID: ${goldenCase.caseId}`,
        });
      }
      ids.add(goldenCase.caseId);
    }
  });

export type ModerationGoldenDataset = z.infer<typeof moderationGoldenDatasetSchema>;

export const moderationPredictionSchema = z
  .object({
    caseId: z.string().min(3),
    predictedAction: z.enum(CANONICAL_MODERATION_ACTIONS).nullable(),
    reasonCodes: z.array(z.enum(MODERATION_REASON_CODES)).default([]),
    abstained: z.boolean(),
    confidence: z.number().min(0).max(1),
    reviewerAction: z.enum(CANONICAL_MODERATION_ACTIONS).optional(),
    latencyMs: z.number().int().min(0).default(0),
    costMicros: z.number().int().min(0).default(0),
  })
  .superRefine((prediction, context) => {
    if (prediction.abstained !== (prediction.predictedAction === null)) {
      context.addIssue({
        code: "custom",
        message:
          "Abstained predictions must have no action and non-abstained predictions need one.",
      });
    }
  });

export const moderationEvaluationRunSchema = z
  .object({
    schemaVersion: z.literal(MODERATION_EVALUATION_SCHEMA_VERSION),
    runId: z.string().min(3).max(96),
    datasetVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    modelProvider: z.string().min(1).max(48),
    modelName: z.string().min(1).max(96),
    modelVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    createdAt: z.string().datetime(),
    predictions: z.array(moderationPredictionSchema),
  })
  .superRefine((run, context) => {
    const ids = new Set<string>();
    for (const [index, prediction] of run.predictions.entries()) {
      if (ids.has(prediction.caseId)) {
        context.addIssue({
          code: "custom",
          path: ["predictions", index, "caseId"],
          message: `Duplicate prediction: ${prediction.caseId}`,
        });
      }
      ids.add(prediction.caseId);
    }
  });

export type ModerationEvaluationRun = z.infer<typeof moderationEvaluationRunSchema>;
