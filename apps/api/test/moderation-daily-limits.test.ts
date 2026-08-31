import { describe, expect, it } from "vitest";
import {
  evaluateModerationRuntimeGate,
  moderationProviderRuntimeConfig,
  providerRuntimeDiagnostic,
} from "../src/modules/moderation-providers/runtime-gate.js";
import { judgeDiagnostic, policyJudgeConfig } from "../src/modules/policy-judge/contracts.js";
import { judgeConfig, providerConfig } from "./helpers/policy-judge-fixtures.js";

describe("explicit daily limit opt-out", () => {
  const provider = () => ({
    ...providerConfig(),
    MODERATION_DAILY_LIMITS_ENABLED: false,
    MODERATION_PROVIDER_DAILY_CALL_CAP: 0,
    MODERATION_PROVIDER_DAILY_COST_MICROS_CAP: 0,
  });
  const judge = () => ({
    ...judgeConfig(),
    MODERATION_DAILY_LIMITS_ENABLED: false,
    MODERATION_POLICY_JUDGE_DAILY_CALL_CAP: 0,
    MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP: 0,
  });
  const gate = (config = provider(), extra = {}) =>
    evaluateModerationRuntimeGate({
      config,
      normalizedInputHash: "0".repeat(64),
      callsToday: 1_000_000,
      costMicrosToday: 2_000_000_000,
      requiredCalls: 2,
      ...extra,
    });

  it("keeps existing defaults and requires the literal false opt-out", () => {
    expect(moderationProviderRuntimeConfig({}).MODERATION_DAILY_LIMITS_ENABLED).toBe(true);
    expect(policyJudgeConfig({}).MODERATION_DAILY_LIMITS_ENABLED).toBe(true);
    for (const parse of [moderationProviderRuntimeConfig, policyJudgeConfig]) {
      expect(
        parse({ MODERATION_DAILY_LIMITS_ENABLED: "false" }).MODERATION_DAILY_LIMITS_ENABLED,
      ).toBe(false);
      expect(() => parse({ MODERATION_DAILY_LIMITS_ENABLED: "no" })).toThrow();
    }
  });

  it("removes both daily call and spend ceilings without changing configured cap values", () => {
    expect(gate()).toMatchObject({ allowed: true });
    expect(providerRuntimeDiagnostic(provider())).toMatchObject({
      dailyLimitsEnabled: false,
      dailyCallCap: 0,
    });
    expect(judgeDiagnostic(judge(), provider())).toMatchObject({
      allowed: true,
      dailyLimitsEnabled: false,
      dailyCallCap: 0,
    });
    expect(gate({ ...provider(), MODERATION_DAILY_LIMITS_ENABLED: true })).toMatchObject({
      allowed: false,
      reason: "DAILY_CALL_CAP_DISABLED",
    });
    expect(
      judgeDiagnostic({ ...judge(), MODERATION_DAILY_LIMITS_ENABLED: true }, provider()).reason,
    ).toBe("BUDGET_ZERO");
  });

  it("never skips privacy, credentials, kill switches, input validation, or circuit breaking", () => {
    expect(gate({ ...provider(), MODERATION_PROVIDER_KILL_SWITCH: true }).allowed).toBe(false);
    expect(gate({ ...provider(), OPENAI_API_KEY: undefined }).allowed).toBe(false);
    expect(
      gate({ ...provider(), evidence: { ...provider().evidence, dpaExecuted: false } }).allowed,
    ).toBe(false);
    expect(gate(provider(), { requiredCalls: 3 }).reason).toBe("INVALID_PROVIDER_REQUEST_COUNT");
    expect(gate(provider(), { recentCalls: 6, recentFailures: 6 }).reason).toBe(
      "PROVIDER_CIRCUIT_OPEN",
    );
    expect(
      judgeDiagnostic({ ...judge(), MODERATION_POLICY_JUDGE_RESPONSES_APPROVED: false }, provider())
        .allowed,
    ).toBe(false);
    expect(
      judgeDiagnostic({ ...judge(), MODERATION_POLICY_JUDGE_KILL_SWITCH: true }, provider())
        .allowed,
    ).toBe(false);
  });
});
