import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { outboxStatusEnum } from "./enums.js";

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("event_id").defaultRandom().primaryKey(),
    aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum("status").default("PENDING").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    totalAttemptCount: integer("total_attempt_count").default(0).notNull(),
    requeueCount: integer("requeue_count").default(0).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("outbox_events_pending_idx")
      .on(table.availableAt, table.occurredAt)
      .where(sql`${table.status} = 'PENDING'`),
    index("outbox_events_dead_letter_idx")
      .on(table.deadLetteredAt, table.occurredAt)
      .where(sql`${table.status} = 'FAILED'`),
    check("outbox_events_schema_version_check", sql`${table.schemaVersion} > 0`),
    check("outbox_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("outbox_events_total_attempt_count_check", sql`${table.totalAttemptCount} >= 0`),
    check("outbox_events_requeue_count_check", sql`${table.requeueCount} >= 0`),
    check(
      "outbox_events_claim_check",
      sql`(${table.claimToken} is null and ${table.claimedAt} is null)
        or (${table.status} = 'PENDING' and ${table.claimToken} is not null and ${table.claimedAt} is not null)`,
    ),
    check(
      "outbox_events_delivery_state_check",
      sql`(${table.status} = 'PENDING' and ${table.publishedAt} is null and ${table.deadLetteredAt} is null)
        or (${table.status} = 'PUBLISHED' and ${table.publishedAt} is not null and ${table.deadLetteredAt} is null and ${table.claimToken} is null)
        or (${table.status} = 'FAILED' and ${table.publishedAt} is null and ${table.deadLetteredAt} is not null and ${table.claimToken} is null)`,
    ),
  ],
);
