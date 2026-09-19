import { and, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../database/client.js";
import {
  radarTopics,
  radarEvents,
  radarEventTopics,
  radarEvidence,
  radarObservations,
  radarObservationRevisions,
  radarEventObservations,
  radarIssueLinks,
} from "../../database/schema/radar.js";
import {
  radarTopicSchema,
  radarEventSchema,
  radarEvidenceSchema,
  radarIssueLinkSchema,
} from "./contracts.js";
import { normalizeRadarObservation } from "./normalize.js";

const timestamp = z.iso.datetime({ offset: true });
const retention = z.strictObject({ fetchedAt: timestamp, expiresAt: timestamp }).refine((value) => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.fetchedAt);
  return duration > 0 && duration <= 86_400_000;
}, "Retention must be positive and at most 24 hours");
const eventBundle = z
  .strictObject({
    topics: z.array(radarTopicSchema).min(1).max(100),
    event: radarEventSchema,
    evidence: z.array(radarEvidenceSchema.extend({ expiresAt: timestamp })).max(100),
    issueLinks: z.array(radarIssueLinkSchema).max(100),
    observationIds: z.array(z.uuid()).max(1000),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.topics.map((topic) => topic.id));
    if (
      ids.size !== value.topics.length ||
      value.event.topicIds.some((id) => !ids.has(id)) ||
      value.topics.some((topic) => !value.event.topicIds.includes(topic.id)) ||
      value.evidence.some((evidence) => evidence.eventId !== value.event.id) ||
      value.issueLinks.some((link) => link.eventId !== value.event.id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Bundle references must belong to this event and its topics",
      });
    }
    for (const evidence of value.evidence) {
      if (
        !retention.safeParse({ fetchedAt: evidence.observedAt, expiresAt: evidence.expiresAt })
          .success
      ) {
        ctx.addIssue({ code: "custom", message: "Invalid evidence retention" });
      }
    }
  });

/** Persistence only, not a public API. R04 callers must enforce R02 rights and reservations.
 * Ingestion does not publish questions or mutate their versions/votes.
 */
export function createRadarRepository(database: Database) {
  return {
    async saveObservation(input: unknown, lifetime: unknown, expectedContentHash?: string) {
      const normalized = normalizeRadarObservation(input);
      const times = retention.parse(lifetime);
      const o = normalized.observation;
      const values = {
        observationKey: normalized.observationKey,
        contentHash: normalized.contentHash,
        source: o.source,
        sourceItemId: o.sourceItemId,
        sourceUrl: o.sourceUrl,
        title: o.title,
        metricName: o.metricName,
        countryCode: o.scope.countryCode,
        queryKey: o.scope.queryKey,
        dimensionsKey: o.scope.dimensionsKey,
        windowStart: new Date(o.window.start),
        windowEnd: new Date(o.window.end),
        granularity: o.window.granularity,
        sampledAt: new Date(o.sampledAt),
        sourceUpdatedAt: o.sourceUpdatedAt ? new Date(o.sourceUpdatedAt) : null,
        metricKind: o.metric.kind,
        metricValue: o.metric.value,
        comparisonKey: "comparisonKey" in o.metric ? o.metric.comparisonKey : null,
        fetchedAt: new Date(times.fetchedAt),
        expiresAt: new Date(times.expiresAt),
      };
      return database.db.transaction(async (tx) => {
        await tx
          .insert(radarObservations)
          .values(values)
          .onConflictDoNothing({ target: radarObservations.observationKey });
        const [existing] = await tx
          .select()
          .from(radarObservations)
          .where(eq(radarObservations.observationKey, normalized.observationKey))
          .for("update");
        if (!existing) throw new Error("RADAR_OBSERVATION_MISSING");
        if (existing.contentHash !== normalized.contentHash) {
          // Never let an out-of-order retry silently restore older content.
          if (expectedContentHash !== existing.contentHash)
            throw new Error("RADAR_CORRECTION_CONFLICT");
          await tx
            .update(radarObservations)
            .set({
              ...values,
              fetchedAt: existing.fetchedAt,
              expiresAt: new Date(
                Math.min(existing.expiresAt.getTime(), values.expiresAt.getTime()),
              ),
            })
            .where(eq(radarObservations.id, existing.id));
        }
        await tx
          .insert(radarObservationRevisions)
          .values({
            observationId: existing.id,
            contentHash: normalized.contentHash,
            payload: o,
          })
          .onConflictDoNothing();
        return {
          id: existing.id,
          observationKey: normalized.observationKey,
          contentHash: normalized.contentHash,
        };
      });
    },

    async saveEventBundle(input: unknown) {
      const bundle = eventBundle.parse(input);
      // Insert-only identities: corrections require an explicit review/update workflow.
      // Do not silently merge same-named topics or overwrite an existing reviewed event.
      await database.db.transaction(async (tx) => {
        for (const topic of bundle.topics) {
          await tx.insert(radarTopics).values(topic).onConflictDoNothing();
          const [existing] = await tx
            .select()
            .from(radarTopics)
            .where(eq(radarTopics.id, topic.id));
          if (existing?.name !== topic.name) throw new Error("RADAR_TOPIC_CONFLICT");
        }
        const e = bundle.event;
        await tx
          .insert(radarEvents)
          .values({
            id: e.id,
            title: e.title,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : null,
            timePrecision: e.timePrecision,
          })
          .onConflictDoNothing();
        const [existing] = await tx
          .select()
          .from(radarEvents)
          .where(eq(radarEvents.id, e.id))
          .for("update");
        if (
          !existing ||
          existing.title !== e.title ||
          existing.timePrecision !== e.timePrecision ||
          (existing.occurredAt?.toISOString() ?? null) !== e.occurredAt
        )
          throw new Error("RADAR_EVENT_CONFLICT");
        for (const topicId of new Set(e.topicIds)) {
          await tx
            .insert(radarEventTopics)
            .values({ eventId: e.id, topicId })
            .onConflictDoNothing();
        }
        for (const evidence of bundle.evidence) {
          const row = {
            ...evidence,
            publishedAt: evidence.publishedAt ? new Date(evidence.publishedAt) : null,
            observedAt: new Date(evidence.observedAt),
            expiresAt: new Date(evidence.expiresAt),
          };
          await tx.insert(radarEvidence).values(row).onConflictDoNothing();
          const [saved] = await tx
            .select()
            .from(radarEvidence)
            .where(eq(radarEvidence.id, evidence.id));
          if (
            !saved ||
            saved.eventId !== row.eventId ||
            saved.source !== row.source ||
            saved.sourceUrl !== row.sourceUrl ||
            saved.claim !== row.claim ||
            saved.status !== row.status ||
            saved.observedAt.getTime() !== row.observedAt.getTime() ||
            saved.expiresAt.getTime() !== row.expiresAt.getTime() ||
            (saved.publishedAt?.getTime() ?? null) !== (row.publishedAt?.getTime() ?? null)
          )
            throw new Error("RADAR_EVIDENCE_CONFLICT");
        }
        for (const link of bundle.issueLinks)
          await tx.insert(radarIssueLinks).values(link).onConflictDoNothing();
        for (const observationId of new Set(bundle.observationIds)) {
          await tx
            .insert(radarEventObservations)
            .values({ eventId: e.id, observationId })
            .onConflictDoNothing();
        }
      });
      return bundle.event.id;
    },

    async findUnexpiredObservation(id: string, now: string) {
      z.uuid().parse(id);
      const at = new Date(timestamp.parse(now));
      const [row] = await database.db
        .select()
        .from(radarObservations)
        .where(
          and(
            eq(radarObservations.id, id),
            lte(radarObservations.fetchedAt, at),
            gt(radarObservations.expiresAt, at),
          ),
        );
      return row ?? null;
    },
  };
}
