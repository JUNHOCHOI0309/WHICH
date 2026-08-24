import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyAnalyticsRetention,
  readAnalyticsReconciliation,
  readAnalyticsSummary,
  readMeasurementBaseline,
} from "../src/analytics-operator.js";
import { readLimitedBetaEvidence } from "../src/beta-operator.js";
import type { Database } from "../src/database/client.js";
import {
  analyticsDailyMetrics,
  analyticsEvents,
  analyticsSessions,
  issueChoices,
  issues,
  issueVersions,
  votes,
} from "../src/database/schema/index.js";
import { registerAnalyticsRoutes } from "../src/modules/analytics/routes.js";
import { createAnalyticsService } from "../src/modules/analytics/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;
const issueId = randomUUID();
const choiceAId = randomUUID();
const secondIssueId = randomUUID();
const secondChoiceAId = randomUUID();

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  await database.db.insert(issues).values([{ id: issueId }, { id: secondIssueId }]);
  await database.db.insert(issueVersions).values([
    {
      issueId,
      version: 1,
      question: "Analytics test issue",
      contentHash: "a".repeat(64),
      primaryCategoryCode: "TEST",
      experienceModeCode: "BINARY",
      taxonomyVersion: "v1",
      publishedAt: new Date(),
    },
    {
      issueId: secondIssueId,
      version: 1,
      question: "Second analytics test issue",
      contentHash: "b".repeat(64),
      primaryCategoryCode: "TEST",
      experienceModeCode: "BINARY",
      taxonomyVersion: "v1",
      publishedAt: new Date(),
    },
  ]);
  await database.db.insert(issueChoices).values([
    { id: choiceAId, issueId, issueVersion: 1, code: "A", label: "A" },
    { id: randomUUID(), issueId, issueVersion: 1, code: "B", label: "B" },
    { id: secondChoiceAId, issueId: secondIssueId, issueVersion: 1, code: "A", label: "A" },
    { id: randomUUID(), issueId: secondIssueId, issueVersion: 1, code: "B", label: "B" },
  ]);
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("first-party analytics", () => {
  it("authenticates ingestion, deduplicates event_id, and links a server-accepted vote", async () => {
    const analytics = createAnalyticsService(database.db);
    const app = Fastify({ logger: false });
    await registerAnalyticsRoutes(app, analytics, "analytics-test-secret");
    const sessionId = randomUUID();
    const eventId = randomUUID();
    const payload = {
      eventId,
      sessionId,
      eventType: "ISSUE_VIEWABLE_IMPRESSION" as const,
      issueId,
      issueVersion: 1,
      occurredAt: new Date().toISOString(),
      context: {
        entrySurface: "EXTERNAL" as const,
        audienceSegment: "GUEST" as const,
        deviceSegment: "MOBILE" as const,
        trafficClass: "PRODUCT" as const,
      },
      attribution: {
        source: "naver" as const,
        medium: "choice" as const,
        campaign: "launch",
        content: "card-a",
        capturedAt: new Date().toISOString(),
      },
    };

    expect(
      (await app.inject({ method: "POST", url: "/v1/internal/analytics/events", payload }))
        .statusCode,
    ).toBe(401);
    const first = await app.inject({
      method: "POST",
      url: "/v1/internal/analytics/events",
      headers: { "x-internal-auth-secret": "analytics-test-secret" },
      payload,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/internal/analytics/events",
      headers: { "x-internal-auth-secret": "analytics-test-secret" },
      payload,
    });
    expect(first.json()).toEqual({ accepted: true, duplicate: false });
    expect(duplicate.json()).toEqual({ accepted: true, duplicate: true });

    await analytics.recordEvent({ ...payload, eventId: randomUUID(), eventType: "RESULT_VIEW" });
    await analytics.recordEvent({
      ...payload,
      eventId: randomUUID(),
      eventType: "NEXT_ISSUE_OPEN",
    });

    const voting = createGuestVoteService(database.db);
    const guest = await voting.createGuestSubject();
    const vote = await voting.submitGuestVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId: guest.anonymousSubjectId,
      issueId,
      issueVersion: 1,
      choiceId: choiceAId,
      analyticsSessionId: sessionId,
    });
    expect(vote.httpStatus).toBe(201);
    const secondVote = await voting.submitGuestVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId: guest.anonymousSubjectId,
      issueId: secondIssueId,
      issueVersion: 1,
      choiceId: secondChoiceAId,
      analyticsSessionId: sessionId,
    });
    expect(secondVote.httpStatus).toBe(201);

    const storedEvents = await database.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.sessionId, sessionId));
    const [storedSession] = await database.db
      .select()
      .from(analyticsSessions)
      .where(eq(analyticsSessions.id, sessionId));
    const [storedVote] = await database.db
      .select({ analyticsSessionId: votes.analyticsSessionId })
      .from(votes)
      .where(eq(votes.analyticsSessionId, sessionId));
    expect(storedEvents).toHaveLength(3);
    expect(storedSession).toMatchObject({
      attributionSource: "naver",
      attributionMedium: "choice",
      attributionCampaign: "launch",
      attributionContent: "card-a",
    });
    expect(storedVote?.analyticsSessionId).toBe(sessionId);

    const summary = await readAnalyticsSummary(database.db, 1);
    expect(summary.metrics).toMatchObject({
      qualifiedVotePerSession: 2,
      firstVoteConversion: 1,
      secondVoteConversion: 1,
      nextIssueRate: 1,
    });
    expect(summary.segments).toEqual([
      expect.objectContaining({
        source: "naver",
        medium: "choice",
        entry_surface: "EXTERNAL",
        audience_segment: "GUEST",
        device_segment: "MOBILE",
        accepted_votes: 2,
        second_vote_sessions: 1,
      }),
    ]);
    const reconciliation = await readAnalyticsReconciliation(database.db, 1);
    expect(reconciliation.voteEventLedger).toMatchObject({
      acceptedVotes: 2,
      analyticsLinkedVotes: 2,
      acceptedVotesMissingSubmitEvent: 2,
      acceptedVotesMissingResultEvent: 1,
    });
    expect(reconciliation.voteAggregateProjection).toEqual({
      mismatchedIssues: 0,
      absoluteVoteDelta: 0,
    });
    const baseline = await readMeasurementBaseline(database.db, 1);
    expect(baseline).toMatchObject({
      status: "READY",
      experimentPreRegistration: {
        experimentId: "which-50-next-issue-cta-v1",
        status: "PLANNED",
        primaryMetric: "nextIssueRate",
      },
      contentSupply: { activeIssues: 2 },
    });
    const betaEvidence = await readLimitedBetaEvidence(
      database.db,
      {
        schemaVersion: 1,
        betaId: "which-52-integration-test",
        status: "PLANNED",
        cohort: { targetInvitedUsers: 1, minimumFeedbackResponses: 1 },
        observation: { minimumHours: 24, defaultReviewWindowDays: 1 },
        evidenceThresholds: {
          minimumQualifiedSessions: 1,
          minimumActiveIssues: 1,
          maximumModerationQueue: 0,
          maximumOldestModerationCaseHours: 0,
          maximumVoteAggregateMismatches: 0,
          maximumDeadLetters: 0,
        },
        decisionPolicy: {
          requireNoOpenReleaseBlockers: true,
          requireNoUnrecoveredSev1: true,
          requireNoUnrecoveredDataIncident: true,
          automatedEvidenceDoesNotMakeFinalDecision: true,
        },
      },
      {
        schemaVersion: 1,
        betaId: "which-52-integration-test",
        observationStartedAt: "2026-08-23T00:00:00.000Z",
        observationEndedAt: "2026-08-25T00:00:00.000Z",
        invitedUsers: 1,
        feedbackResponses: 1,
        feedbackThemes: [],
        incidents: [],
        releaseBlockers: [],
        notes: [],
      },
      1,
      new Date("2026-08-25T00:00:00.000Z"),
    );
    expect(betaEvidence).toMatchObject({
      evidenceStatus: "READY_FOR_DECISION",
      operationalSignals: {
        moderation: { currentQueueSize: 0 },
        reliability: { deadLetters: 0 },
      },
    });
    expect(betaEvidence.reportDigest).toMatch(/^[a-f0-9]{64}$/);
    await app.close();
  });

  it("excludes explicitly classified test traffic from the official funnel", async () => {
    const analytics = createAnalyticsService(database.db);
    await analytics.recordEvent({
      eventId: randomUUID(),
      sessionId: randomUUID(),
      eventType: "ISSUE_VIEWABLE_IMPRESSION",
      issueId,
      issueVersion: 1,
      occurredAt: new Date().toISOString(),
      context: {
        entrySurface: "HOME",
        audienceSegment: "GUEST",
        deviceSegment: "DESKTOP",
        trafficClass: "TEST",
      },
    });

    const summary = await readAnalyticsSummary(database.db, 1);
    expect(summary.metrics.qualifiedSessions).toBe(1);
    expect(summary.trafficCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ traffic_class: "TEST", sessions: 1 })]),
    );
  });

  it("aggregates before deleting raw events older than 90 days", async () => {
    const analytics = createAnalyticsService(database.db);
    const sessionId = randomUUID();
    const eventId = randomUUID();
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1_000);
    await analytics.recordEvent({
      eventId,
      sessionId,
      eventType: "ISSUE_VIEWABLE_IMPRESSION",
      issueId,
      issueVersion: 1,
      occurredAt: oldDate.toISOString(),
    });
    await database.db
      .update(analyticsEvents)
      .set({ receivedAt: oldDate })
      .where(eq(analyticsEvents.id, eventId));
    await database.db
      .update(analyticsSessions)
      .set({ lastActivityAt: oldDate, expiresAt: new Date(oldDate.getTime() + 30 * 60_000) })
      .where(eq(analyticsSessions.id, sessionId));

    const result = await applyAnalyticsRetention(database.db);
    expect(result).toMatchObject({ deletedEvents: 1, deletedSessions: 1 });
    expect(
      await database.db.select().from(analyticsEvents).where(eq(analyticsEvents.id, eventId)),
    ).toHaveLength(0);
    const aggregate = await database.db
      .select()
      .from(analyticsDailyMetrics)
      .where(eq(analyticsDailyMetrics.source, "direct"));
    expect(aggregate).toEqual(
      expect.arrayContaining([expect.objectContaining({ qualifiedSessions: 1 })]),
    );
  });
});
