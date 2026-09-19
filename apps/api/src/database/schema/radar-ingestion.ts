import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { radarSources } from "./radar.js";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const radarIngestionRuns = pgTable(
  "radar_ingestion_runs",
  {
    id: uuid("run_id").defaultRandom().primaryKey(),
    dispatchKey: varchar("dispatch_key", { length: 128 }).notNull(),
    source: varchar("source_code", { length: 32 })
      .notNull()
      .references(() => radarSources.code, { onDelete: "restrict" }),
    operation: varchar("operation", { length: 200 }).notNull(),
    quotaScopeId: varchar("quota_scope_id", { length: 200 }).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).default("PENDING").notNull(),
    sampledAt: instant("sampled_at").notNull(),
    availableAt: instant("available_at").notNull(),
    claimToken: uuid("claim_token"),
    claimedAt: instant("claimed_at"),
    leaseExpiresAt: instant("lease_expires_at"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    pageCount: integer("page_count").default(0).notNull(),
    observationCount: integer("observation_count").default(0).notNull(),
    truncated: boolean("truncated").default(false).notNull(),
    missingCoverage: jsonb("missing_coverage").$type<string[]>().default([]).notNull(),
    failureCode: varchar("failure_code", { length: 32 }),
    lastError: varchar("last_error", { length: 2000 }),
    startedAt: instant("started_at"),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").defaultNow().notNull(),
    updatedAt: instant("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("radar_ingestion_runs_dispatch_unique").on(table.dispatchKey),
    check("radar_runs_dispatch_check", sql`${table.dispatchKey} ~ '^[0-9a-zA-Z:_-]{1,128}$'`),
    check(
      "radar_runs_status_check",
      sql`${table.status} in ('PENDING','RUNNING','SUCCEEDED','EMPTY_VALID','PARTIAL','FAILED')`,
    ),
    check(
      "radar_runs_failure_check",
      sql`${table.failureCode} is null or ${table.failureCode} in ('RATE_LIMIT','TIMEOUT','AUTH','UPSTREAM','INVALID_RESPONSE','BUDGET_EXHAUSTED','POLICY_DENIED','LEASE_EXPIRED')`,
    ),
    check(
      "radar_runs_counts_check",
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} between 1 and 20 and ${table.attemptCount} <= ${table.maxAttempts} and ${table.pageCount} >= 0 and ${table.observationCount} >= 0`,
    ),
    check(
      "radar_runs_lease_check",
      sql`(${table.status} = 'RUNNING' and ${table.claimToken} is not null and ${table.claimedAt} is not null and ${table.leaseExpiresAt} > ${table.claimedAt} and ${table.completedAt} is null)
        or (${table.status} <> 'RUNNING' and ${table.claimToken} is null and ${table.claimedAt} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "radar_runs_terminal_check",
      sql`(${table.status} in ('PENDING','RUNNING') and ${table.completedAt} is null)
        or (${table.status} in ('SUCCEEDED','EMPTY_VALID','PARTIAL','FAILED') and ${table.completedAt} is not null)`,
    ),
    check(
      "radar_runs_result_check",
      sql`(${table.status} = 'SUCCEEDED' and ${table.pageCount} > 0 and ${table.observationCount} > 0 and ${table.failureCode} is null and not ${table.truncated} and jsonb_array_length(${table.missingCoverage}) = 0)
        or (${table.status} = 'EMPTY_VALID' and ${table.pageCount} > 0 and ${table.observationCount} = 0 and ${table.failureCode} is null and not ${table.truncated} and jsonb_array_length(${table.missingCoverage}) = 0)
        or (${table.status} = 'PARTIAL' and ${table.pageCount} > 0 and ${table.observationCount} > 0 and ${table.failureCode} is not null and (${table.truncated} or jsonb_array_length(${table.missingCoverage}) > 0))
        or (${table.status} = 'FAILED' and ${table.failureCode} is not null and ${table.observationCount} = 0)
        or (${table.status} in ('PENDING','RUNNING') and ${table.completedAt} is null)`,
    ),
    index("radar_runs_claim_idx").on(table.status, table.availableAt),
    index("radar_runs_source_sample_idx").on(table.source, table.sampledAt),
    index("radar_runs_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const radarQuotaDailyUsage = pgTable(
  "radar_quota_daily_usage",
  {
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    source: varchar("source_code", { length: 32 })
      .notNull()
      .references(() => radarSources.code, { onDelete: "restrict" }),
    quotaScopeId: varchar("quota_scope_id", { length: 200 }).notNull(),
    pool: varchar("pool", { length: 200 }).notNull(),
    dayKey: date("day_key", { mode: "string" }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    unitCount: integer("unit_count").default(0).notNull(),
    updatedAt: instant("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.policyVersion, table.source, table.quotaScopeId, table.pool, table.dayKey],
      name: "radar_quota_daily_usage_pk",
    }),
    check(
      "radar_quota_daily_counts_check",
      sql`${table.requestCount} >= 0 and ${table.unitCount} >= 0`,
    ),
  ],
);

export const radarRunQuotaUsage = pgTable(
  "radar_run_quota_usage",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => radarIngestionRuns.id, { onDelete: "cascade" }),
    pool: varchar("pool", { length: 200 }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    unitCount: integer("unit_count").default(0).notNull(),
    updatedAt: instant("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.pool], name: "radar_run_quota_usage_pk" }),
    check(
      "radar_run_quota_counts_check",
      sql`${table.requestCount} >= 0 and ${table.unitCount} >= 0`,
    ),
  ],
);

export const radarProviderRequests = pgTable(
  "radar_provider_requests",
  {
    id: uuid("request_id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => radarIngestionRuns.id, { onDelete: "cascade" }),
    requestKey: varchar("request_key", { length: 128 }).notNull(),
    operation: varchar("operation", { length: 200 }).notNull(),
    pool: varchar("pool", { length: 200 }).notNull(),
    unitCost: integer("unit_cost").notNull(),
    status: varchar("status", { length: 16 }).default("RESERVED").notNull(),
    httpStatus: integer("http_status"),
    failureCode: varchar("failure_code", { length: 32 }),
    retryable: boolean("retryable"),
    reservedAt: instant("reserved_at").notNull(),
    completedAt: instant("completed_at"),
  },
  (table) => [
    unique("radar_provider_requests_key_unique").on(table.runId, table.requestKey),
    check(
      "radar_provider_requests_key_check",
      sql`${table.requestKey} ~ '^[0-9a-zA-Z:_-]{1,128}$'`,
    ),
    check(
      "radar_provider_requests_state_check",
      sql`(${table.status} = 'RESERVED' and ${table.completedAt} is null and ${table.httpStatus} is null and ${table.failureCode} is null and ${table.retryable} is null)
        or (${table.status} = 'SUCCEEDED' and ${table.completedAt} is not null and ${table.failureCode} is null and ${table.retryable} = false)
        or (${table.status} = 'FAILED' and ${table.completedAt} is not null and ${table.failureCode} is not null and ${table.retryable} is not null)`,
    ),
    check(
      "radar_provider_requests_failure_check",
      sql`${table.failureCode} is null or ${table.failureCode} in ('RATE_LIMIT','TIMEOUT','AUTH','UPSTREAM','INVALID_RESPONSE','BUDGET_EXHAUSTED','POLICY_DENIED','LEASE_EXPIRED')`,
    ),
    check(
      "radar_provider_requests_value_check",
      sql`${table.unitCost} > 0 and (${table.httpStatus} is null or ${table.httpStatus} between 100 and 599)`,
    ),
    index("radar_provider_requests_run_idx").on(table.runId, table.reservedAt),
  ],
);
