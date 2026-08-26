import { eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import { analyticsEvents, analyticsSessions, issueVersions } from "../../database/schema/index.js";
import type { AnalyticsService } from "./contracts.js";
import type { AnalyticsEventCommand } from "./contracts.js";

const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1_000;

export class AnalyticsEventError extends Error {
  constructor(
    public readonly code: "ISSUE_NOT_FOUND" | "INVALID_QUALITY_PAYLOAD" | "EVENT_ID_CONFLICT",
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsEventError";
  }
}

const CHOICE_POSITION_EVENTS = new Set(["VOTE_SUBMIT", "ISSUE_MEDIA_LOAD"]);

function validateQuality(command: AnalyticsEventCommand) {
  const quality = command.quality;
  if (command.eventType === "RESULT_DWELL_COMPLETE" && quality?.durationMs === undefined) {
    throw new AnalyticsEventError(
      "INVALID_QUALITY_PAYLOAD",
      400,
      "Result dwell events require durationMs.",
    );
  }
  if (
    quality?.durationMs !== undefined &&
    command.eventType !== "VOTE_SUBMIT" &&
    command.eventType !== "RESULT_DWELL_COMPLETE"
  ) {
    throw new AnalyticsEventError(
      "INVALID_QUALITY_PAYLOAD",
      400,
      "durationMs is not allowed for this event type.",
    );
  }
  const hasChoice = quality?.canonicalChoiceId !== undefined;
  const hasPosition = quality?.shownPosition !== undefined;
  if (hasChoice !== hasPosition || (hasChoice && !CHOICE_POSITION_EVENTS.has(command.eventType))) {
    throw new AnalyticsEventError(
      "INVALID_QUALITY_PAYLOAD",
      400,
      "canonicalChoiceId and shownPosition must be supplied together for a choice event.",
    );
  }
  if (command.eventType === "ISSUE_MEDIA_LOAD") {
    if (!quality?.mediaMode || !quality.mediaLoadOutcome) {
      throw new AnalyticsEventError(
        "INVALID_QUALITY_PAYLOAD",
        400,
        "Media load events require mediaMode and mediaLoadOutcome.",
      );
    }
  } else if (quality?.mediaLoadOutcome !== undefined) {
    throw new AnalyticsEventError(
      "INVALID_QUALITY_PAYLOAD",
      400,
      "mediaLoadOutcome is only allowed for media load events.",
    );
  }
}

type StoredEventIdentity = {
  sessionId: string;
  eventType: string;
  issueId: string;
  issueVersion: number;
  recommendationRequestId: string | null;
  shareCardId: string | null;
  durationMs: number | null;
  canonicalChoiceId: string | null;
  shownPosition: number | null;
  mediaMode: string | null;
  mediaLoadOutcome: string | null;
};

function matchesStoredEvent(stored: StoredEventIdentity, command: AnalyticsEventCommand) {
  return (
    stored.sessionId === command.sessionId &&
    stored.eventType === command.eventType &&
    stored.issueId === command.issueId &&
    stored.issueVersion === command.issueVersion &&
    stored.recommendationRequestId === (command.recommendationRequestId ?? null) &&
    stored.shareCardId === (command.shareCardId ?? null) &&
    stored.durationMs === (command.quality?.durationMs ?? null) &&
    stored.canonicalChoiceId === (command.quality?.canonicalChoiceId ?? null) &&
    stored.shownPosition === (command.quality?.shownPosition ?? null) &&
    stored.mediaMode === (command.quality?.mediaMode ?? null) &&
    stored.mediaLoadOutcome === (command.quality?.mediaLoadOutcome ?? null)
  );
}

function assertMatchingDuplicate(stored: StoredEventIdentity, command: AnalyticsEventCommand) {
  if (!matchesStoredEvent(stored, command)) {
    throw new AnalyticsEventError(
      "EVENT_ID_CONFLICT",
      409,
      "The event ID is already used by a different analytics event.",
    );
  }
}

export function createAnalyticsService(database: Database["db"]): AnalyticsService {
  return {
    async recordEvent(command) {
      validateQuality(command);
      const occurredAt = new Date(command.occurredAt);
      const activityAt = new Date();
      const startedAt = occurredAt > activityAt ? activityAt : occurredAt;
      const expiresAt = new Date(activityAt.getTime() + SESSION_IDLE_MILLISECONDS);
      const context = command.context ?? {
        entrySurface: "UNKNOWN" as const,
        audienceSegment: "UNKNOWN" as const,
        deviceSegment: "UNKNOWN" as const,
        trafficClass: "UNCLASSIFIED" as const,
      };

      return database.transaction(async (transaction) => {
        const [issueVersion] = await transaction
          .select({ issueId: issueVersions.issueId })
          .from(issueVersions)
          .where(
            sql`${issueVersions.issueId} = ${command.issueId} and ${issueVersions.version} = ${command.issueVersion}`,
          )
          .limit(1);
        if (!issueVersion) {
          throw new AnalyticsEventError("ISSUE_NOT_FOUND", 404, "The issue version was not found.");
        }

        const [existingEvent] = await transaction
          .select({
            sessionId: analyticsEvents.sessionId,
            eventType: analyticsEvents.eventType,
            issueId: analyticsEvents.issueId,
            issueVersion: analyticsEvents.issueVersion,
            recommendationRequestId: analyticsEvents.recommendationRequestId,
            shareCardId: analyticsEvents.shareCardId,
            durationMs: analyticsEvents.durationMs,
            canonicalChoiceId: analyticsEvents.canonicalChoiceId,
            shownPosition: analyticsEvents.shownPosition,
            mediaMode: analyticsEvents.mediaMode,
            mediaLoadOutcome: analyticsEvents.mediaLoadOutcome,
          })
          .from(analyticsEvents)
          .where(eq(analyticsEvents.id, command.eventId))
          .limit(1);
        if (existingEvent) {
          assertMatchingDuplicate(existingEvent, command);
          return { accepted: true, duplicate: true };
        }

        const attribution = command.attribution;
        await transaction
          .insert(analyticsSessions)
          .values({
            id: command.sessionId,
            attributionSource: attribution?.source,
            attributionMedium: attribution?.medium,
            attributionCampaign: attribution?.campaign,
            attributionContent: attribution?.content,
            attributionCapturedAt: attribution ? new Date(attribution.capturedAt) : undefined,
            entrySurface: context.entrySurface,
            audienceSegment: context.audienceSegment,
            deviceSegment: context.deviceSegment,
            trafficClass: context.trafficClass,
            startedAt,
            lastActivityAt: activityAt,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: analyticsSessions.id,
            set: {
              attributionSource: sql`coalesce(${analyticsSessions.attributionSource}, excluded.attribution_source)`,
              attributionMedium: sql`coalesce(${analyticsSessions.attributionMedium}, excluded.attribution_medium)`,
              attributionCampaign: sql`coalesce(${analyticsSessions.attributionCampaign}, excluded.attribution_campaign)`,
              attributionContent: sql`coalesce(${analyticsSessions.attributionContent}, excluded.attribution_content)`,
              attributionCapturedAt: sql`coalesce(${analyticsSessions.attributionCapturedAt}, excluded.attribution_captured_at)`,
              entrySurface: sql`case when ${analyticsSessions.entrySurface} = 'UNKNOWN' then excluded.entry_surface else ${analyticsSessions.entrySurface} end`,
              audienceSegment: sql`case
                when excluded.audience_segment = 'MEMBER' then 'MEMBER'
                when ${analyticsSessions.audienceSegment} = 'UNKNOWN' then excluded.audience_segment
                else ${analyticsSessions.audienceSegment}
              end`,
              deviceSegment: sql`case when ${analyticsSessions.deviceSegment} = 'UNKNOWN' then excluded.device_segment else ${analyticsSessions.deviceSegment} end`,
              trafficClass: sql`case
                when excluded.traffic_class in ('TEST', 'OPERATOR', 'BOT') then excluded.traffic_class
                when ${analyticsSessions.trafficClass} = 'UNCLASSIFIED' then excluded.traffic_class
                else ${analyticsSessions.trafficClass}
              end`,
              lastActivityAt: activityAt,
              expiresAt,
              updatedAt: activityAt,
            },
          });

        const inserted = await transaction
          .insert(analyticsEvents)
          .values({
            id: command.eventId,
            sessionId: command.sessionId,
            eventType: command.eventType,
            issueId: command.issueId,
            issueVersion: command.issueVersion,
            recommendationRequestId: command.recommendationRequestId,
            shareCardId: command.shareCardId,
            durationMs: command.quality?.durationMs,
            canonicalChoiceId: command.quality?.canonicalChoiceId,
            shownPosition: command.quality?.shownPosition,
            mediaMode: command.quality?.mediaMode,
            mediaLoadOutcome: command.quality?.mediaLoadOutcome,
            occurredAt,
          })
          .onConflictDoNothing({ target: analyticsEvents.id })
          .returning({ id: analyticsEvents.id });

        if (inserted.length === 0) {
          const [racedEvent] = await transaction
            .select({
              sessionId: analyticsEvents.sessionId,
              eventType: analyticsEvents.eventType,
              issueId: analyticsEvents.issueId,
              issueVersion: analyticsEvents.issueVersion,
              recommendationRequestId: analyticsEvents.recommendationRequestId,
              shareCardId: analyticsEvents.shareCardId,
              durationMs: analyticsEvents.durationMs,
              canonicalChoiceId: analyticsEvents.canonicalChoiceId,
              shownPosition: analyticsEvents.shownPosition,
              mediaMode: analyticsEvents.mediaMode,
              mediaLoadOutcome: analyticsEvents.mediaLoadOutcome,
            })
            .from(analyticsEvents)
            .where(eq(analyticsEvents.id, command.eventId))
            .limit(1);
          if (!racedEvent) {
            throw new Error("The analytics event insert was not observable after a conflict.");
          }
          assertMatchingDuplicate(racedEvent, command);
        }
        return { accepted: true, duplicate: inserted.length === 0 };
      });
    },
  };
}

export async function ensureAnalyticsSession(
  database: Database["db"],
  sessionId: string,
  activityAt = new Date(),
) {
  const expiresAt = new Date(activityAt.getTime() + SESSION_IDLE_MILLISECONDS);
  await database
    .insert(analyticsSessions)
    .values({
      id: sessionId,
      startedAt: activityAt,
      lastActivityAt: activityAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: analyticsSessions.id,
      set: { lastActivityAt: activityAt, expiresAt, updatedAt: activityAt },
      setWhere: eq(analyticsSessions.id, sessionId),
    });
}
