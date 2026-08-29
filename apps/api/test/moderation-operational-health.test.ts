import { describe, expect, it } from "vitest";

import { evaluateModerationOperationalHealth } from "../src/modules/moderation-operations/operational-health.js";
import type { ModerationProviderRuntimeDiagnostic } from "../src/modules/moderation-providers/runtime-gate.js";

const runtime: ModerationProviderRuntimeDiagnostic = {
  mode: "SHADOW",
  provider: "OPENAI_MODERATION",
  killSwitch: false,
  canaryPercent: 1,
  dailyCallCap: 50,
  dailyCostMicrosCap: 0,
  circuitWindowMinutes: 5,
  circuitMinimumCalls: 5,
  circuitFailurePercent: 50,
  modelSnapshot: "omni-moderation-2024-09-26",
  apiKeyConfigured: true,
  privacyGateAllowed: true,
  privacyGateReason: "PROVIDER_GATE_SATISFIED",
  missingEvidence: [],
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    runtime,
    callsToday: 5,
    calls7d: 10,
    succeeded7d: 9,
    failed7d: 1,
    skipped7d: 0,
    costMicrosToday: 0,
    costMicros7d: 0,
    latencyP95Ms: 800,
    cacheHits7d: 2,
    completedRuns7d: 12,
    modelRuns7d: 10,
    recentCircuitCalls: 4,
    recentCircuitFailures: 3,
    pending: 1,
    running: 0,
    failed: 0,
    deadLettered: 0,
    oldestPendingAgeSeconds: 120,
    reconciliationMismatches: 0,
    reconciliationFailed: 0,
    reconciliationRepaired7d: 1,
    ...overrides,
  };
}

describe("moderation operational health", () => {
  it("reports bounded provider and worker metrics without pausing healthy uploads", () => {
    const health = evaluateModerationOperationalHealth(input());
    expect(health.directUploadAllowed).toBe(true);
    expect(health.provider).toMatchObject({
      circuitState: "CLOSED",
      errorRate7d: 0.1,
      cacheHitRate7d: 2 / 12,
      automationCoverage7d: 10 / 12,
    });
    expect(health.alerts).toEqual([]);
  });

  it("opens the circuit and pauses new uploads after a sustained provider failure burst", () => {
    const health = evaluateModerationOperationalHealth(
      input({ recentCircuitCalls: 6, recentCircuitFailures: 4 }),
    );
    expect(health.provider.circuitState).toBe("OPEN");
    expect(health.directUploadAllowed).toBe(false);
    expect(health.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODERATION_PROVIDER_CIRCUIT_OPEN" }),
      ]),
    );
  });

  it("fails closed on dead letters, queue SLO breach, and reconciliation failures", () => {
    const health = evaluateModerationOperationalHealth(
      input({
        deadLettered: 1,
        oldestPendingAgeSeconds: 49 * 3600,
        reconciliationFailed: 1,
      }),
    );
    expect(health.directUploadAllowed).toBe(false);
    expect(health.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        "MODERATION_DEAD_LETTERS",
        "MODERATION_QUEUE_SLO_BREACH",
        "MODERATION_STORAGE_RECONCILIATION",
      ]),
    );
  });
});
