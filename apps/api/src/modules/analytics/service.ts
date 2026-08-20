import { eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import { analyticsEvents, analyticsSessions, issueVersions } from "../../database/schema/index.js";
import type { AnalyticsService } from "./contracts.js";

const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1_000;

export class AnalyticsEventError extends Error {
  constructor(
    public readonly code: "ISSUE_NOT_FOUND",
    public readonly statusCode: 404,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsEventError";
  }
}

export function createAnalyticsService(database: Database["db"]): AnalyticsService {
  return {
    async recordEvent(command) {
      const occurredAt = new Date(command.occurredAt);
      const activityAt = new Date();
      const startedAt = occurredAt > activityAt ? activityAt : occurredAt;
      const expiresAt = new Date(activityAt.getTime() + SESSION_IDLE_MILLISECONDS);

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
            occurredAt,
          })
          .onConflictDoNothing({ target: analyticsEvents.id })
          .returning({ id: analyticsEvents.id });

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
