import sharp from "sharp";
import type { ModerationProviderInput } from "../../src/modules/moderation-providers/contracts.js";
import { moderationProviderRuntimeConfig } from "../../src/modules/moderation-providers/runtime-gate.js";
import { EMBEDDED_TEXT_VERSION } from "../../src/modules/issue-media/embedded-text.js";
import { policyJudgeConfig, type JudgeDecision } from "../../src/modules/policy-judge/contracts.js";

export const clearDecision: JudgeDecision = {
  decision: "ALLOW",
  reason_codes: ["NONE"],
  image_relevance: "RELATED",
  pair_fairness: "BALANCED",
  privacy_risk: "LOW",
  rights_risk: "LOW",
  needs_human: false,
};
export const judgeConfig = () =>
  policyJudgeConfig({
    MODERATION_POLICY_JUDGE_MODE: "SHADOW",
    MODERATION_POLICY_JUDGE_KILL_SWITCH: "false",
    MODERATION_POLICY_JUDGE_RESPONSES_APPROVED: "true",
    MODERATION_POLICY_JUDGE_CANARY_PERCENT: "100",
    MODERATION_POLICY_JUDGE_DAILY_CALL_CAP: "100",
    MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP: "1000000",
  });
export const providerConfig = () =>
  moderationProviderRuntimeConfig({
    OPENAI_API_KEY: "unit-test-only-not-a-key",
    MODERATION_PROVIDER_MODE: "SHADOW",
    MODERATION_PROVIDER: "OPENAI_MODERATION",
    MODERATION_PROVIDER_KILL_SWITCH: "false",
    MODERATION_PROVIDER_CANARY_PERCENT: "100",
    MODERATION_PROVIDER_DAILY_CALL_CAP: "100",
    MODERATION_PROVIDER_APPROVAL_EVIDENCE:
      "dpaExecuted,noTrainingConfirmed,retentionTermsRecorded,deletionTermsRecorded,subprocessorsRecorded,processingRegionRecorded,encryptionConfirmed,credentialRotationOwnerAssigned,breachResponseRecorded,internationalTransferLegalReviewApproved,providerDataControlApproved",
  });
export async function pairInput(): Promise<ModerationProviderInput> {
  const body = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: "#0891a1" },
  })
    .webp()
    .toBuffer();
  const image = {
    dataUrl: `data:image/webp;base64,${body.toString("base64")}`,
    mimeType: "image/webp" as const,
    width: 1024,
    height: 768,
    byteLength: body.length,
    metadataStripped: true as const,
    reencoded: true as const,
  };
  return {
    targetType: "ISSUE_VERSION",
    scope: "SUBMISSION_REVISION",
    modality: "TEXT_AND_IMAGE",
    images: [image, image],
    text: "어떤 색이 좋나요? A: 파랑 B: 초록",
    context: { question: "어떤 색이 좋나요?", choices: ["파랑", "초록"], piiRedacted: true },
    embeddedText: {
      version: EMBEDDED_TEXT_VERSION,
      images: ["a", "b"].map((c) => ({
        normalizedHash: c.repeat(64),
        status: "COMPLETE",
        characters: 0,
      })),
    },
  };
}
