import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import {
  radarEvents,
  radarEventSourceReferences,
  radarResolutionActions,
  radarTopicAliases,
  radarTopics,
} from "../../database/schema/radar.js";
import { radarSourceSchema } from "./contracts.js";
import {
  canonicalLanguageCode,
  eventReferenceKey,
  normalizeEntityLabel,
  topicAliasKey,
} from "./entity-resolution.js";

const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable().default(null);
const entityTypeSchema = z.enum(["TOPIC", "EVENT"]);
const topicAliasInput = z.strictObject({
  id: z.uuid(),
  topicId: z.uuid(),
  alias: z.string().min(1).max(500),
  languageCode: z.string().trim().min(2).max(35),
  source: radarSourceSchema.nullable().default(null),
  validFrom: nullableTimestamp,
  validUntil: nullableTimestamp,
  status: z.enum(["CANDIDATE", "VERIFIED", "REJECTED"]),
});
const eventReferenceInput = z.strictObject({
  id: z.uuid(),
  eventId: z.uuid(),
  source: radarSourceSchema,
  sourceItemId: z.string().trim().min(1).max(500),
  title: z.string().min(1).max(500),
  languageCode: z.string().trim().min(2).max(35),
  observedAt: timestamp,
});
const resolutionActionInput = z
  .strictObject({
    id: z.uuid(),
    entityType: entityTypeSchema,
    action: z.enum(["MERGE", "SPLIT", "REVERT"]),
    subjectId: z.uuid(),
    targetIds: z.array(z.uuid()).max(100),
    revertsActionId: z.uuid().nullable().default(null),
    reason: z.string().trim().min(1).max(2_000),
    actor: z.string().trim().min(1).max(200),
    resolverVersion: z.string().trim().min(1).max(100),
  })
  .superRefine((value, context) => {
    const uniqueTargets = new Set(value.targetIds);
    if (uniqueTargets.size !== value.targetIds.length || uniqueTargets.has(value.subjectId)) {
      context.addIssue({ code: "custom", message: "Resolution targets must be unique peers" });
    }
    if (
      (value.action === "MERGE" &&
        (value.targetIds.length !== 1 || value.revertsActionId !== null)) ||
      (value.action === "SPLIT" &&
        (value.targetIds.length < 2 || value.revertsActionId !== null)) ||
      (value.action === "REVERT" &&
        (value.targetIds.length !== 0 || value.revertsActionId === null))
    ) {
      context.addIssue({ code: "custom", message: "Resolution action shape is invalid" });
    }
  });

type EntityType = z.infer<typeof resolutionActionInput>["entityType"];
type ResolutionAction = typeof radarResolutionActions.$inferSelect;
export type RadarResolutionState =
  | { status: "ACTIVE"; actionId: null }
  | { status: "MERGED"; actionId: string; targetId: string }
  | { status: "SPLIT"; actionId: string; targetIds: string[] };

function stateFrom(actions: ResolutionAction[]): RadarResolutionState {
  const reverted = new Set(
    actions.flatMap((action) =>
      action.action === "REVERT" && action.revertsActionId ? [action.revertsActionId] : [],
    ),
  );
  const latest = [...actions]
    .reverse()
    .find((action) => action.action !== "REVERT" && !reverted.has(action.id));
  if (!latest) return { status: "ACTIVE", actionId: null };
  if (latest.action === "MERGE") {
    const targetId = latest.targetIds[0];
    if (!targetId) throw new Error("RADAR_RESOLUTION_HISTORY_INVALID");
    return { status: "MERGED", actionId: latest.id, targetId };
  }
  if (latest.action === "SPLIT") {
    return { status: "SPLIT", actionId: latest.id, targetIds: [...latest.targetIds] };
  }
  throw new Error("RADAR_RESOLUTION_HISTORY_INVALID");
}

function sameDates(left: Date | null, right: string | null) {
  return (left?.toISOString() ?? null) === (right === null ? null : new Date(right).toISOString());
}

/** Audit persistence for deterministic resolution inputs and explicit human/model decisions. */
export function createRadarEntityResolutionRepository(database: Database) {
  type Transaction = Parameters<Parameters<typeof database.db.transaction>[0]>[0];

  async function loadActions(transaction: Transaction, entityType: EntityType, subjectId: string) {
    return transaction
      .select()
      .from(radarResolutionActions)
      .where(
        and(
          eq(radarResolutionActions.entityType, entityType),
          eq(radarResolutionActions.subjectId, subjectId),
        ),
      )
      .orderBy(asc(radarResolutionActions.sequence));
  }

  async function lockEntities(transaction: Transaction, entityType: EntityType, ids: string[]) {
    const ordered = [...new Set(ids)].sort();
    const rows =
      entityType === "TOPIC"
        ? await transaction
            .select({ id: radarTopics.id })
            .from(radarTopics)
            .where(inArray(radarTopics.id, ordered))
            .orderBy(asc(radarTopics.id))
            .for("update")
        : await transaction
            .select({ id: radarEvents.id })
            .from(radarEvents)
            .where(inArray(radarEvents.id, ordered))
            .orderBy(asc(radarEvents.id))
            .for("update");
    if (rows.length !== ordered.length) throw new Error("RADAR_RESOLUTION_ENTITY_MISSING");
  }

  return {
    async saveTopicAlias(input: unknown) {
      const parsed = topicAliasInput.parse(input);
      if (
        parsed.validFrom &&
        parsed.validUntil &&
        Date.parse(parsed.validUntil) <= Date.parse(parsed.validFrom)
      ) {
        throw new Error("INVALID_TOPIC_ALIAS_VALIDITY");
      }
      const normalizedAlias = normalizeEntityLabel(parsed.alias);
      const language = canonicalLanguageCode(parsed.languageCode);
      const aliasKey = topicAliasKey({
        topicId: parsed.topicId,
        alias: parsed.alias,
        languageCode: language,
        source: parsed.source,
        validFrom: parsed.validFrom,
        validUntil: parsed.validUntil,
        status: parsed.status,
      });
      return database.db.transaction(async (transaction) => {
        const [topic] = await transaction
          .select({ id: radarTopics.id })
          .from(radarTopics)
          .where(eq(radarTopics.id, parsed.topicId));
        if (!topic) throw new Error("RADAR_TOPIC_MISSING");
        await transaction
          .insert(radarTopicAliases)
          .values({
            id: parsed.id,
            aliasKey,
            topicId: parsed.topicId,
            alias: parsed.alias.normalize("NFC").replace(/\s+/gu, " ").trim(),
            normalizedAlias,
            languageCode: language,
            source: parsed.source,
            validFrom: parsed.validFrom ? new Date(parsed.validFrom) : null,
            validUntil: parsed.validUntil ? new Date(parsed.validUntil) : null,
            status: parsed.status,
          })
          .onConflictDoUpdate({
            target: radarTopicAliases.aliasKey,
            set: { status: parsed.status },
          });
        const [saved] = await transaction
          .select()
          .from(radarTopicAliases)
          .where(eq(radarTopicAliases.aliasKey, aliasKey));
        if (
          !saved ||
          saved.topicId !== parsed.topicId ||
          saved.normalizedAlias !== normalizedAlias ||
          saved.languageCode !== language ||
          saved.source !== parsed.source ||
          saved.status !== parsed.status ||
          !sameDates(saved.validFrom, parsed.validFrom) ||
          !sameDates(saved.validUntil, parsed.validUntil)
        ) {
          throw new Error("RADAR_TOPIC_ALIAS_CONFLICT");
        }
        return { id: saved.id, aliasKey };
      });
    },

    async saveEventSourceReference(input: unknown) {
      const parsed = eventReferenceInput.parse(input);
      const title = parsed.title.normalize("NFC").replace(/\s+/gu, " ").trim();
      const normalizedTitle = normalizeEntityLabel(title);
      const language = canonicalLanguageCode(parsed.languageCode);
      const referenceKey = eventReferenceKey(parsed);
      return database.db.transaction(async (transaction) => {
        const [event] = await transaction
          .select({ id: radarEvents.id })
          .from(radarEvents)
          .where(eq(radarEvents.id, parsed.eventId));
        if (!event) throw new Error("RADAR_EVENT_MISSING");
        await transaction
          .insert(radarEventSourceReferences)
          .values({
            id: parsed.id,
            referenceKey,
            eventId: parsed.eventId,
            source: parsed.source,
            sourceItemId: parsed.sourceItemId,
            title,
            normalizedTitle,
            languageCode: language,
            observedAt: new Date(parsed.observedAt),
          })
          .onConflictDoNothing();
        const [saved] = await transaction
          .select()
          .from(radarEventSourceReferences)
          .where(
            and(
              eq(radarEventSourceReferences.source, parsed.source),
              eq(radarEventSourceReferences.sourceItemId, parsed.sourceItemId),
            ),
          );
        if (
          !saved ||
          saved.referenceKey !== referenceKey ||
          saved.eventId !== parsed.eventId ||
          saved.normalizedTitle !== normalizedTitle ||
          saved.languageCode !== language ||
          saved.observedAt.toISOString() !== new Date(parsed.observedAt).toISOString()
        ) {
          throw new Error("RADAR_EVENT_REFERENCE_CONFLICT");
        }
        return { id: saved.id, referenceKey };
      });
    },

    async recordResolutionAction(input: unknown) {
      const parsed = resolutionActionInput.parse(input);
      const normalized = { ...parsed, targetIds: [...parsed.targetIds].sort() };
      return database.db.transaction(async (transaction) => {
        await lockEntities(transaction, normalized.entityType, [
          normalized.subjectId,
          ...normalized.targetIds,
        ]);
        const [existing] = await transaction
          .select()
          .from(radarResolutionActions)
          .where(eq(radarResolutionActions.id, normalized.id));
        if (existing) {
          if (
            existing.entityType !== normalized.entityType ||
            existing.action !== normalized.action ||
            existing.subjectId !== normalized.subjectId ||
            JSON.stringify(existing.targetIds) !== JSON.stringify(normalized.targetIds) ||
            existing.revertsActionId !== normalized.revertsActionId ||
            existing.reason !== normalized.reason ||
            existing.actor !== normalized.actor ||
            existing.resolverVersion !== normalized.resolverVersion
          ) {
            throw new Error("RADAR_RESOLUTION_ACTION_CONFLICT");
          }
          return {
            actionId: existing.id,
            state: stateFrom(
              await loadActions(transaction, normalized.entityType, normalized.subjectId),
            ),
          };
        }
        const history = await loadActions(transaction, normalized.entityType, normalized.subjectId);
        const current = stateFrom(history);
        if (normalized.action === "REVERT") {
          if (current.status === "ACTIVE" || current.actionId !== normalized.revertsActionId) {
            throw new Error("RADAR_RESOLUTION_REVERT_CONFLICT");
          }
        } else {
          if (current.status !== "ACTIVE") throw new Error("RADAR_RESOLUTION_SUBJECT_RETIRED");
          for (const targetId of normalized.targetIds) {
            const targetState = stateFrom(
              await loadActions(transaction, normalized.entityType, targetId),
            );
            if (targetState.status !== "ACTIVE") {
              throw new Error("RADAR_RESOLUTION_TARGET_RETIRED");
            }
          }
        }
        const [saved] = await transaction
          .insert(radarResolutionActions)
          .values(normalized)
          .returning();
        if (!saved) throw new Error("RADAR_RESOLUTION_ACTION_MISSING");
        return {
          actionId: saved.id,
          state: stateFrom([...history, saved]),
        };
      });
    },

    async readResolutionHistory(entityType: EntityType, subjectId: string) {
      entityTypeSchema.parse(entityType);
      z.uuid().parse(subjectId);
      return database.db.transaction(async (transaction) => {
        await lockEntities(transaction, entityType, [subjectId]);
        return loadActions(transaction, entityType, subjectId);
      });
    },

    async readResolutionState(entityType: EntityType, subjectId: string) {
      entityTypeSchema.parse(entityType);
      z.uuid().parse(subjectId);
      return database.db.transaction(async (transaction) => {
        await lockEntities(transaction, entityType, [subjectId]);
        return stateFrom(await loadActions(transaction, entityType, subjectId));
      });
    },
  };
}
