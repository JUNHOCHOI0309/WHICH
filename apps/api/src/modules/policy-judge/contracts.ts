import { createHash } from "node:crypto";
import { z } from "zod";
import {
  providerRuntimeDiagnostic,
  type ModerationProviderRuntimeConfig,
} from "../moderation-providers/runtime-gate.js";

export const POLICY_JUDGE_MODEL = "gpt-5.6-luna";
// Responses retention differs from the original moderation-only notice. Never reuse v1 consent.
export const POLICY_JUDGE_CONSENT_VERSION = "which-media-consent-v2";
// Bump on prompt/schema/pricing/routing/derivative changes; never reuse an old approval profile.
export const POLICY_JUDGE_PROFILE = "which-luna-review-v2";
export const POLICY_JUDGE_PROVIDER = "OPENAI_POLICY_JUDGE";
export const POLICY_JUDGE_MAX_OUTPUT = 384;
export const POLICY_JUDGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const judgeDecisionSchema = z
  .object({
    decision: z.enum(["ALLOW", "REVIEW", "BLOCK", "ABSTAIN"]),
    reason_codes: z
      .array(
        z.enum([
          "NONE",
          "SEXUAL",
          "VIOLENCE",
          "HATE_HARASSMENT",
          "PRIVACY",
          "SPAM",
          "RIGHTS_UNCERTAIN",
          "IRRELEVANT",
          "PAIR_UNFAIR",
          "INSUFFICIENT_DETAIL",
          "UNCERTAIN",
        ]),
      )
      .min(1)
      .max(8),
    image_relevance: z.enum(["RELATED", "UNRELATED", "UNCERTAIN"]),
    pair_fairness: z.enum(["BALANCED", "UNBALANCED", "UNCERTAIN"]),
    privacy_risk: z.enum(["LOW", "HIGH", "UNCERTAIN"]),
    rights_risk: z.enum(["LOW", "HIGH", "UNCERTAIN"]),
    needs_human: z.boolean(),
  })
  .strict();
export type JudgeDecision = z.infer<typeof judgeDecisionSchema>;
export const judgeUsageSchema = z
  .object({
    input_tokens: z.number().int().min(0).max(100_000),
    output_tokens: z.number().int().min(0).max(10_000),
    input_tokens_details: z.object({ cached_tokens: z.number().int().min(0) }),
  })
  .refine((v) => v.input_tokens_details.cached_tokens <= v.input_tokens);
export type JudgeUsage = z.infer<typeof judgeUsageSchema>;

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const configSchema = z.object({
  MODERATION_POLICY_JUDGE_MODE: z.enum(["OFF", "SHADOW"]).default("OFF"),
  MODERATION_POLICY_JUDGE_KILL_SWITCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Responses has different retention semantics from /moderations; key reuse is not privacy approval.
  MODERATION_POLICY_JUDGE_RESPONSES_APPROVED: bool,
  MODERATION_POLICY_JUDGE_CANARY_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  MODERATION_POLICY_JUDGE_AUDIT_PERCENT: z.coerce.number().int().min(0).max(100).default(5),
  MODERATION_DAILY_LIMITS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MODERATION_POLICY_JUDGE_DAILY_CALL_CAP: z.coerce.number().int().min(0).max(100_000).default(0),
  MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .default(0),
  MODERATION_POLICY_JUDGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
});
export function policyJudgeConfig(env: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(env);
}
export type PolicyJudgeConfig = ReturnType<typeof policyJudgeConfig>;

export function judgeDiagnostic(
  config: PolicyJudgeConfig,
  provider: ModerationProviderRuntimeConfig,
) {
  const privacy = providerRuntimeDiagnostic(provider);
  const reason =
    config.MODERATION_POLICY_JUDGE_MODE !== "SHADOW"
      ? "MODE_OFF"
      : config.MODERATION_POLICY_JUDGE_KILL_SWITCH
        ? "KILL_SWITCH"
        : provider.MODERATION_PROVIDER_KILL_SWITCH
          ? "SAFETY_KILL_SWITCH"
          : !privacy.apiKeyConfigured
            ? "API_KEY_MISSING"
            : !privacy.privacyGateAllowed
              ? "PRIVACY_GATE_BLOCKED"
              : !config.MODERATION_POLICY_JUDGE_RESPONSES_APPROVED
                ? "RESPONSES_APPROVAL_REQUIRED"
                : config.MODERATION_POLICY_JUDGE_CANARY_PERCENT === 0
                  ? "CANARY_ZERO"
                  : config.MODERATION_DAILY_LIMITS_ENABLED &&
                      (config.MODERATION_POLICY_JUDGE_DAILY_CALL_CAP === 0 ||
                        config.MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP === 0)
                    ? "BUDGET_ZERO"
                    : "SHADOW_READY";
  return {
    model: POLICY_JUDGE_MODEL,
    profile: POLICY_JUDGE_PROFILE,
    requiredConsentVersion: POLICY_JUDGE_CONSENT_VERSION,
    mode: config.MODERATION_POLICY_JUDGE_MODE,
    allowed: reason === "SHADOW_READY",
    reason,
    apiKeyConfigured: privacy.apiKeyConfigured,
    dailyCallCap: config.MODERATION_POLICY_JUDGE_DAILY_CALL_CAP,
    dailyLimitsEnabled: config.MODERATION_DAILY_LIMITS_ENABLED,
    dailyCostMicrosCap: config.MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP,
    canaryPercent: config.MODERATION_POLICY_JUDGE_CANARY_PERCENT,
    auditPercent: config.MODERATION_POLICY_JUDGE_AUDIT_PERCENT,
    publicationChanged: false as const,
  };
}

export function sampleBucket(hash: string, salt: string) {
  return (
    parseInt(createHash("sha256").update(`${salt}:${hash}`).digest("hex").slice(0, 8), 16) % 100
  );
}

export function judgeCosts(usage: JudgeUsage) {
  const cached = usage.input_tokens_details.cached_tokens;
  // Standard token-price estimate; the budget ceiling also covers 1.25x cache-write input pricing.
  return {
    costMicros: Math.ceil(
      (usage.input_tokens - cached) * 0.2 + cached * 0.02 + usage.output_tokens * 1.2,
    ),
    chargedMicros: Math.ceil(usage.input_tokens * 0.25 + usage.output_tokens * 1.2),
  };
}
