import { sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import type { ModerationProviderRuntimeDiagnostic } from "../moderation-providers/runtime-gate.js";

export type ModerationOperationalAlert = {
  code: string;
  severity: "WARNING" | "CRITICAL";
  message: string;
};

export type ModerationOperationalHealth = {
  provider: ModerationProviderRuntimeDiagnostic & {
    callsToday: number;
    calls7d: number;
    succeeded7d: number;
    failed7d: number;
    skipped7d: number;
    costMicrosToday: number;
    costMicros7d: number;
    latencyP95Ms: number | null;
    errorRate7d: number;
    cacheHitRate7d: number;
    automationCoverage7d: number;
    circuitState: "CLOSED" | "OPEN";
  };
  worker: {
    pending: number;
    running: number;
    failed: number;
    deadLettered: number;
    oldestPendingAgeSeconds: number | null;
  };
  reconciliation: {
    mismatches: number;
    failed: number;
    repaired7d: number;
  };
  directUploadAllowed: boolean;
  alerts: ModerationOperationalAlert[];
};

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

export function evaluateModerationOperationalHealth(input: {
  runtime: ModerationProviderRuntimeDiagnostic;
  callsToday: number;
  calls7d: number;
  succeeded7d: number;
  failed7d: number;
  skipped7d: number;
  costMicrosToday: number;
  costMicros7d: number;
  latencyP95Ms: number | null;
  cacheHits7d: number;
  completedRuns7d: number;
  modelRuns7d: number;
  recentCircuitCalls: number;
  recentCircuitFailures: number;
  pending: number;
  running: number;
  failed: number;
  deadLettered: number;
  oldestPendingAgeSeconds: number | null;
  reconciliationMismatches: number;
  reconciliationFailed: number;
  reconciliationRepaired7d: number;
}): ModerationOperationalHealth {
  const alerts: ModerationOperationalAlert[] = [];
  const providerEnabled = input.runtime.mode === "SHADOW" && !input.runtime.killSwitch;
  const circuitState =
    input.recentCircuitCalls >= input.runtime.circuitMinimumCalls &&
    (input.recentCircuitFailures / Math.max(1, input.recentCircuitCalls)) * 100 >=
      input.runtime.circuitFailurePercent
      ? "OPEN"
      : "CLOSED";
  if (input.deadLettered > 0) {
    alerts.push({
      code: "MODERATION_DEAD_LETTERS",
      severity: "CRITICAL",
      message: `Dead letter ${input.deadLettered}건을 재처리하거나 원인을 확인해야 합니다.`,
    });
  }
  if (input.oldestPendingAgeSeconds !== null && input.oldestPendingAgeSeconds > 48 * 3600) {
    alerts.push({
      code: "MODERATION_QUEUE_SLO_BREACH",
      severity: "CRITICAL",
      message: "가장 오래된 Moderation 작업이 48시간 SLO를 넘었습니다.",
    });
  } else if (input.oldestPendingAgeSeconds !== null && input.oldestPendingAgeSeconds > 15 * 60) {
    alerts.push({
      code: "MODERATION_QUEUE_DELAYED",
      severity: "WARNING",
      message: "Moderation Worker 시작 지연이 15분을 넘었습니다.",
    });
  }
  if (input.reconciliationFailed > 0 || input.reconciliationMismatches > 0) {
    alerts.push({
      code: "MODERATION_STORAGE_RECONCILIATION",
      severity: "CRITICAL",
      message: "R2·DB·CDN 불일치 또는 복구 실패가 남아 있습니다.",
    });
  }
  if (providerEnabled && circuitState === "OPEN") {
    alerts.push({
      code: "MODERATION_PROVIDER_CIRCUIT_OPEN",
      severity: "CRITICAL",
      message: "Provider 오류율 Circuit이 열려 외부 호출을 중단했습니다.",
    });
  }
  if (providerEnabled && input.callsToday >= input.runtime.dailyCallCap) {
    alerts.push({
      code: "MODERATION_DAILY_CALL_CAP",
      severity: "WARNING",
      message: "오늘의 Provider 호출 Cap에 도달했습니다.",
    });
  }
  if (providerEnabled && input.costMicrosToday > input.runtime.dailyCostMicrosCap) {
    alerts.push({
      code: "MODERATION_DAILY_COST_CAP",
      severity: "CRITICAL",
      message: "오늘의 Provider 비용 Cap을 초과했습니다.",
    });
  }
  const criticalPauseCodes = new Set([
    "MODERATION_DEAD_LETTERS",
    "MODERATION_QUEUE_SLO_BREACH",
    "MODERATION_STORAGE_RECONCILIATION",
    "MODERATION_PROVIDER_CIRCUIT_OPEN",
    "MODERATION_DAILY_COST_CAP",
  ]);
  return {
    provider: {
      ...input.runtime,
      callsToday: input.callsToday,
      calls7d: input.calls7d,
      succeeded7d: input.succeeded7d,
      failed7d: input.failed7d,
      skipped7d: input.skipped7d,
      costMicrosToday: input.costMicrosToday,
      costMicros7d: input.costMicros7d,
      latencyP95Ms: input.latencyP95Ms,
      errorRate7d: input.calls7d > 0 ? input.failed7d / input.calls7d : 0,
      cacheHitRate7d: input.completedRuns7d > 0 ? input.cacheHits7d / input.completedRuns7d : 0,
      automationCoverage7d:
        input.completedRuns7d > 0 ? input.modelRuns7d / input.completedRuns7d : 0,
      circuitState,
    },
    worker: {
      pending: input.pending,
      running: input.running,
      failed: input.failed,
      deadLettered: input.deadLettered,
      oldestPendingAgeSeconds: input.oldestPendingAgeSeconds,
    },
    reconciliation: {
      mismatches: input.reconciliationMismatches,
      failed: input.reconciliationFailed,
      repaired7d: input.reconciliationRepaired7d,
    },
    directUploadAllowed: !alerts.some((alert) => criticalPauseCodes.has(alert.code)),
    alerts,
  };
}

export async function readModerationOperationalHealth(
  database: Database["db"],
  runtime: ModerationProviderRuntimeDiagnostic,
): Promise<ModerationOperationalHealth> {
  const rows = await database.execute<{
    calls_today: number;
    calls_7d: number;
    succeeded_7d: number;
    failed_7d: number;
    skipped_7d: number;
    cost_micros_today: number;
    cost_micros_7d: number;
    latency_p95_ms: number | null;
    recent_circuit_calls: number;
    recent_circuit_failures: number;
    completed_runs_7d: number;
    model_runs_7d: number;
    cache_hits_7d: number;
    pending_runs: number;
    running_runs: number;
    failed_runs: number;
    dead_lettered_runs: number;
    oldest_pending_age_seconds: number | null;
    reconciliation_mismatches: number;
    reconciliation_failed: number;
    reconciliation_repaired_7d: number;
  }>(sql`
    with provider as (
      select
        count(*) filter (where created_at >= date_trunc('day', now() at time zone 'utc'))::int as calls_today,
        count(*) filter (where created_at >= now() - interval '7 days')::int as calls_7d,
        count(*) filter (where created_at >= now() - interval '7 days' and status = 'SUCCEEDED')::int as succeeded_7d,
        count(*) filter (where created_at >= now() - interval '7 days' and status = 'FAILED')::int as failed_7d,
        count(*) filter (where created_at >= now() - interval '7 days' and status = 'SKIPPED')::int as skipped_7d,
        coalesce(sum(cost_micros) filter (where created_at >= date_trunc('day', now() at time zone 'utc')), 0)::bigint as cost_micros_today,
        coalesce(sum(cost_micros) filter (where created_at >= now() - interval '7 days'), 0)::bigint as cost_micros_7d,
        percentile_cont(0.95) within group (order by latency_ms)
          filter (where created_at >= now() - interval '7 days')::double precision as latency_p95_ms,
        count(*) filter (where created_at >= now() - (${runtime.circuitWindowMinutes}::int * interval '1 minute'))::int as recent_circuit_calls,
        count(*) filter (where created_at >= now() - (${runtime.circuitWindowMinutes}::int * interval '1 minute') and status = 'FAILED')::int as recent_circuit_failures
      from moderation_provider_call_cache
    ), runs as (
      select
        count(*) filter (where completed_at >= now() - interval '7 days')::int as completed_runs_7d,
        count(*) filter (where completed_at >= now() - interval '7 days' and model_provider is not null)::int as model_runs_7d,
        count(*) filter (where completed_at >= now() - interval '7 days' and result->>'cacheHit' = 'true')::int as cache_hits_7d,
        count(*) filter (where status = 'PENDING')::int as pending_runs,
        count(*) filter (where status = 'RUNNING')::int as running_runs,
        count(*) filter (where status = 'FAILED')::int as failed_runs,
        count(*) filter (where status = 'DEAD_LETTERED')::int as dead_lettered_runs,
        extract(epoch from (now() - min(created_at) filter (where status = 'PENDING')))::double precision as oldest_pending_age_seconds
      from moderation_runs
    ), reconciliations as (
      select
        count(*) filter (where status = 'MISMATCH')::int as reconciliation_mismatches,
        count(*) filter (where status = 'FAILED')::int as reconciliation_failed,
        count(*) filter (where status = 'REPAIRED' and resolved_at >= now() - interval '7 days')::int as reconciliation_repaired_7d
      from moderation_reconciliations
    )
    select * from provider cross join runs cross join reconciliations
  `);
  const row = rows.rows[0] ?? ({} as (typeof rows.rows)[number]);
  return evaluateModerationOperationalHealth({
    runtime,
    callsToday: numberValue(row.calls_today),
    calls7d: numberValue(row.calls_7d),
    succeeded7d: numberValue(row.succeeded_7d),
    failed7d: numberValue(row.failed_7d),
    skipped7d: numberValue(row.skipped_7d),
    costMicrosToday: numberValue(row.cost_micros_today),
    costMicros7d: numberValue(row.cost_micros_7d),
    latencyP95Ms: nullableNumber(row.latency_p95_ms),
    cacheHits7d: numberValue(row.cache_hits_7d),
    completedRuns7d: numberValue(row.completed_runs_7d),
    modelRuns7d: numberValue(row.model_runs_7d),
    recentCircuitCalls: numberValue(row.recent_circuit_calls),
    recentCircuitFailures: numberValue(row.recent_circuit_failures),
    pending: numberValue(row.pending_runs),
    running: numberValue(row.running_runs),
    failed: numberValue(row.failed_runs),
    deadLettered: numberValue(row.dead_lettered_runs),
    oldestPendingAgeSeconds: nullableNumber(row.oldest_pending_age_seconds),
    reconciliationMismatches: numberValue(row.reconciliation_mismatches),
    reconciliationFailed: numberValue(row.reconciliation_failed),
    reconciliationRepaired7d: numberValue(row.reconciliation_repaired_7d),
  });
}
