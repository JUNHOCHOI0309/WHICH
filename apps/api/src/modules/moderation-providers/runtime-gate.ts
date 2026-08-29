import { gte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import { moderationProviderCallCache } from "../../database/schema/index.js";
import {
  evaluateImageProviderGate,
  type ProviderGateEvidence,
} from "../moderation/provider-privacy-policy.js";
import type { ModerationProviderGate } from "../moderation-dispatch/service.js";

const evidenceKeys = [
  "dpaExecuted",
  "noTrainingConfirmed",
  "retentionTermsRecorded",
  "deletionTermsRecorded",
  "subprocessorsRecorded",
  "processingRegionRecorded",
  "encryptionConfirmed",
  "credentialRotationOwnerAssigned",
  "breachResponseRecorded",
  "internationalTransferLegalReviewApproved",
  "providerDataControlApproved",
] as const;

const booleanValue = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const environmentSchema = z.object({
  MODERATION_PROVIDER_MODE: z.enum(["OFF", "SHADOW"]).default("OFF"),
  MODERATION_PROVIDER: z.enum(["NONE", "OPENAI_MODERATION"]).default("NONE"),
  MODERATION_PROVIDER_KILL_SWITCH: booleanValue("true"),
  MODERATION_PROVIDER_CANARY_PERCENT: z.coerce.number().min(0).max(100).default(0),
  MODERATION_PROVIDER_DAILY_CALL_CAP: z.coerce.number().int().min(0).default(0),
  MODERATION_PROVIDER_DAILY_COST_MICROS_CAP: z.coerce.number().int().min(0).default(0),
  MODERATION_PROVIDER_CIRCUIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  MODERATION_PROVIDER_CIRCUIT_MIN_CALLS: z.coerce.number().int().min(1).max(100).default(5),
  MODERATION_PROVIDER_CIRCUIT_FAILURE_PERCENT: z.coerce.number().min(1).max(100).default(50),
  MODERATION_PROVIDER_APPROVAL_EVIDENCE: z.string().default(""),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODERATION_MODEL: z.string().min(1).default("omni-moderation-2024-09-26"),
  OPENAI_MODERATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
});

export type ModerationProviderRuntimeConfig = ReturnType<typeof moderationProviderRuntimeConfig>;
export type ModerationProviderRuntimeDiagnostic = ReturnType<typeof providerRuntimeDiagnostic>;

export function moderationProviderRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  const approved = new Set(
    parsed.MODERATION_PROVIDER_APPROVAL_EVIDENCE.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const evidence = Object.fromEntries(
    evidenceKeys.map((key) => [key, approved.has(key)]),
  ) as ProviderGateEvidence;
  return { ...parsed, evidence };
}

export function providerRuntimeDiagnostic(config: ModerationProviderRuntimeConfig) {
  const privacy = evaluateImageProviderGate({
    mode: config.MODERATION_PROVIDER_MODE,
    provider: config.MODERATION_PROVIDER,
    evidence: config.evidence,
  });
  return {
    mode: config.MODERATION_PROVIDER_MODE,
    provider: config.MODERATION_PROVIDER,
    killSwitch: config.MODERATION_PROVIDER_KILL_SWITCH,
    canaryPercent: config.MODERATION_PROVIDER_CANARY_PERCENT,
    dailyCallCap: config.MODERATION_PROVIDER_DAILY_CALL_CAP,
    dailyCostMicrosCap: config.MODERATION_PROVIDER_DAILY_COST_MICROS_CAP,
    circuitWindowMinutes: config.MODERATION_PROVIDER_CIRCUIT_WINDOW_MINUTES,
    circuitMinimumCalls: config.MODERATION_PROVIDER_CIRCUIT_MIN_CALLS,
    circuitFailurePercent: config.MODERATION_PROVIDER_CIRCUIT_FAILURE_PERCENT,
    modelSnapshot: config.OPENAI_MODERATION_MODEL,
    apiKeyConfigured: Boolean(config.OPENAI_API_KEY),
    privacyGateAllowed: privacy.allowed,
    privacyGateReason: privacy.reason,
    missingEvidence: privacy.missingEvidence,
  };
}

export function createModerationProviderGate(input: {
  database: Database["db"];
  config: ModerationProviderRuntimeConfig;
}): ModerationProviderGate {
  return async (target) => {
    const config = input.config;
    const preflight = evaluateModerationRuntimeGate({
      config,
      normalizedInputHash: target.normalizedInputHash,
      callsToday: 0,
    });
    if (!preflight.allowed) return preflight;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const circuitStart = new Date(
      Date.now() - config.MODERATION_PROVIDER_CIRCUIT_WINDOW_MINUTES * 60_000,
    );
    const [usage] = await input.database
      .select({
        calls: sql<number>`count(*)::int`,
        costMicros: sql<number>`coalesce(sum(${moderationProviderCallCache.costMicros}), 0)::bigint`,
      })
      .from(moderationProviderCallCache)
      .where(gte(moderationProviderCallCache.createdAt, dayStart));
    const [circuit] = await input.database
      .select({
        calls: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) filter (where ${moderationProviderCallCache.status} = 'FAILED')::int`,
      })
      .from(moderationProviderCallCache)
      .where(gte(moderationProviderCallCache.createdAt, circuitStart));
    return evaluateModerationRuntimeGate({
      config,
      normalizedInputHash: target.normalizedInputHash,
      callsToday: usage?.calls ?? 0,
      costMicrosToday: Number(usage?.costMicros ?? 0),
      recentCalls: circuit?.calls ?? 0,
      recentFailures: circuit?.failures ?? 0,
    });
  };
}

export function evaluateModerationRuntimeGate(input: {
  config: ModerationProviderRuntimeConfig;
  normalizedInputHash: string;
  callsToday: number;
  costMicrosToday?: number;
  recentCalls?: number;
  recentFailures?: number;
}) {
  const config = input.config;
  if (config.MODERATION_PROVIDER_KILL_SWITCH) {
    return { allowed: false, reason: "GLOBAL_KILL_SWITCH_ENABLED" } as const;
  }
  if (!config.OPENAI_API_KEY) return { allowed: false, reason: "PROVIDER_KEY_MISSING" } as const;
  const privacy = evaluateImageProviderGate({
    mode: config.MODERATION_PROVIDER_MODE,
    provider: config.MODERATION_PROVIDER,
    evidence: config.evidence,
  });
  if (!privacy.allowed) return { allowed: false, reason: privacy.reason } as const;
  if (config.MODERATION_PROVIDER_CANARY_PERCENT <= 0) {
    return { allowed: false, reason: "CANARY_DISABLED" } as const;
  }
  const bucket = Number.parseInt(input.normalizedInputHash.slice(0, 8), 16) / 0xffffffff;
  if (bucket * 100 >= config.MODERATION_PROVIDER_CANARY_PERCENT) {
    return { allowed: false, reason: "OUTSIDE_CANARY" } as const;
  }
  if (config.MODERATION_PROVIDER_DAILY_CALL_CAP <= 0) {
    return { allowed: false, reason: "DAILY_CALL_CAP_DISABLED" } as const;
  }
  if (input.callsToday >= config.MODERATION_PROVIDER_DAILY_CALL_CAP) {
    return { allowed: false, reason: "DAILY_CALL_CAP_REACHED" } as const;
  }
  if ((input.costMicrosToday ?? 0) > config.MODERATION_PROVIDER_DAILY_COST_MICROS_CAP) {
    return { allowed: false, reason: "DAILY_COST_CAP_REACHED" } as const;
  }
  const recentCalls = input.recentCalls ?? 0;
  const recentFailures = input.recentFailures ?? 0;
  if (
    recentCalls >= config.MODERATION_PROVIDER_CIRCUIT_MIN_CALLS &&
    (recentFailures / recentCalls) * 100 >= config.MODERATION_PROVIDER_CIRCUIT_FAILURE_PERCENT
  ) {
    return { allowed: false, reason: "PROVIDER_CIRCUIT_OPEN" } as const;
  }
  return { allowed: true, reason: "SHADOW_CANARY_ALLOWED" } as const;
}
