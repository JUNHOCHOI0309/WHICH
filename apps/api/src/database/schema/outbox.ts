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
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("outbox_events_pending_idx")
      .on(table.availableAt, table.occurredAt)
      .where(sql`${table.status} = 'PENDING'`),
    check("outbox_events_schema_version_check", sql`${table.schemaVersion} > 0`),
    check("outbox_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);
