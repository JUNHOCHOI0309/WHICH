import { z } from "zod";

import type { ModerationDecisionRuntime } from "./decision-engine.js";

const booleanValue = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const environmentSchema = z.object({
  MODERATION_DECISION_MODE: z
    .enum(["OFF", "SHADOW", "REVIEW_ASSIST", "LIMITED_ACTION"])
    .default("OFF"),
  MODERATION_DECISION_KILL_SWITCH: booleanValue("true"),
  MODERATION_DECISION_CANARY_PERCENT: z.coerce.number().min(0).max(100).default(0),
  MODERATION_DECISION_CATEGORY_FLAGS: z.string().default(""),
  MODERATION_PROVISIONAL_RELEASE_APPROVED: booleanValue("false"),
  MODERATION_PROVISIONAL_COHORTS: z.string().default(""),
  MODERATION_PROVISIONAL_ASSET_TYPES: z.string().default(""),
  MODERATION_QUARANTINE_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
  MODERATION_PROVISIONAL_TTL_SECONDS: z.coerce.number().int().min(60).default(21_600),
});

const csv = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export function moderationDecisionRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): ModerationDecisionRuntime {
  const parsed = environmentSchema.parse(environment);
  return {
    mode: parsed.MODERATION_DECISION_MODE,
    killSwitch: parsed.MODERATION_DECISION_KILL_SWITCH,
    canaryPercent: parsed.MODERATION_DECISION_CANARY_PERCENT,
    categoryFlags: Object.fromEntries(
      csv(parsed.MODERATION_DECISION_CATEGORY_FLAGS).map((category) => [category, true]),
    ),
    operationalBudgetHealthy: true,
    provisionalReleaseApproved: parsed.MODERATION_PROVISIONAL_RELEASE_APPROVED,
    provisionalCohorts: csv(parsed.MODERATION_PROVISIONAL_COHORTS),
    provisionalAssetTypes: csv(parsed.MODERATION_PROVISIONAL_ASSET_TYPES),
    quarantineTtlSeconds: parsed.MODERATION_QUARANTINE_TTL_SECONDS,
    provisionalTtlSeconds: parsed.MODERATION_PROVISIONAL_TTL_SECONDS,
  };
}
