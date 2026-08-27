import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { comments } from "./comments.js";
import { commentReactionCodeEnum } from "./enums.js";
import { voterSubjects } from "./subjects.js";

export const commentReactions = pgTable(
  "comment_reactions",
  {
    id: uuid("comment_reaction_id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    originSubjectId: uuid("origin_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    code: commentReactionCodeEnum("reaction_code").default("HELPFUL").notNull(),
    active: boolean("active").default(true).notNull(),
    mergedIntoReactionId: uuid("merged_into_reaction_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("comment_reactions_comment_subject_code_unique").on(
      table.commentId,
      table.subjectId,
      table.code,
    ),
    uniqueIndex("comment_reactions_one_active_per_subject_unique")
      .on(table.commentId, table.subjectId)
      .where(sql`${table.active} = true`),
    foreignKey({
      columns: [table.mergedIntoReactionId],
      foreignColumns: [table.id],
      name: "comment_reactions_merged_into_fk",
    }).onDelete("restrict"),
    index("comment_reactions_active_comment_code_idx")
      .on(table.commentId, table.code)
      .where(sql`${table.active} = true`),
    index("comment_reactions_origin_subject_idx").on(table.originSubjectId, table.createdAt),
    check(
      "comment_reactions_active_shape_check",
      sql`(${table.active} = true and ${table.deactivatedAt} is null and ${table.mergedIntoReactionId} is null)
        or (${table.active} = false and ${table.deactivatedAt} is not null)`,
    ),
    check(
      "comment_reactions_not_self_merged_check",
      sql`${table.mergedIntoReactionId} is null or ${table.mergedIntoReactionId} <> ${table.id}`,
    ),
  ],
);

export const commentReactionAttempts = pgTable(
  "comment_reaction_attempts",
  {
    id: uuid("comment_reaction_attempt_id").primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    actorSubjectId: uuid("actor_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    code: commentReactionCodeEnum("reaction_code").default("HELPFUL").notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("comment_reaction_attempts_actor_received_idx").on(
      table.actorSubjectId,
      table.receivedAt,
    ),
  ],
);
