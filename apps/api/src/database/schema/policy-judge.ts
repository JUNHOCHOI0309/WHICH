import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { moderationRuns } from "./moderation-operations.js";

// USD microdollars. Committed includes outstanding/unknown reservations, not only successes.
export const policyJudgeBudgets = pgTable(
  "policy_judge_budgets",
  {
    day: varchar("day", { length: 10 }).primaryKey(),
    calls: integer("calls").notNull().default(0),
    committedMicros: integer("committed_micros").notNull().default(0),
  },
  (t) => [
    check("policy_judge_budget_nonnegative", sql`${t.calls} >= 0 and ${t.committedMicros} >= 0`),
  ],
);

// One paid attempt per source run/profile. Unknown attempts are never automatically retried.
export const policyJudgeEvaluations = pgTable(
  "policy_judge_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => moderationRuns.id, { onDelete: "restrict" }),
    profile: varchar("profile", { length: 64 }).notNull(),
    cacheKey: varchar("cache_key", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    budgetDay: varchar("budget_day", { length: 10 }).references(() => policyJudgeBudgets.day),
    reservedMicros: integer("reserved_micros").notNull().default(0),
    chargedMicros: integer("charged_micros").notNull().default(0),
    costMicros: integer("cost_micros"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique("policy_judge_source_profile_unique").on(t.sourceRunId, t.profile),
    index("policy_judge_cache_status_idx").on(t.cacheKey, t.status),
    index("policy_judge_created_idx").on(t.createdAt),
    check(
      "policy_judge_status_check",
      sql`${t.status} in ('RUNNING', 'SUCCEEDED', 'ABSTAINED', 'FAILED', 'UNKNOWN', 'STALE', 'SKIPPED', 'CACHE_HIT')`,
    ),
    check(
      "policy_judge_cost_nonnegative",
      sql`${t.reservedMicros} >= 0 and ${t.chargedMicros} >= 0 and (${t.costMicros} is null or ${t.costMicros} >= 0)`,
    ),
  ],
);
