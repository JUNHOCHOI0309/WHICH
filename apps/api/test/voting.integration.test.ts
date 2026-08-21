import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  analyticsSessions,
  issueChoices,
  issues,
  issueVersions,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
  voteAttempts,
  votes,
} from "../src/database/schema/index.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

type TestIssue = {
  issueId: string;
  choiceAId: string;
  choiceBId: string;
};

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createIssue(options: { riskLevel?: "LOW" | "RESTRICTED" } = {}): Promise<TestIssue> {
  const issueId = randomUUID();
  const choiceAId = randomUUID();
  const choiceBId = randomUUID();

  await database.db.insert(issues).values({
    id: issueId,
    riskLevel: options.riskLevel ?? "LOW",
  });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "Which option do you choose?",
    contentHash: "a".repeat(64),
    primaryCategoryCode: "TEST",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt: new Date(),
  });
  await database.db.insert(issueChoices).values([
    { id: choiceAId, issueId, issueVersion: 1, code: "A", label: "Option A" },
    { id: choiceBId, issueId, issueVersion: 1, code: "B", label: "Option B" },
  ]);

  return { issueId, choiceAId, choiceBId };
}

async function createGuestSubject() {
  const response = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  expect(response.statusCode).toBe(201);
  return response.json<{ anonymousSubjectId: string }>().anonymousSubjectId;
}

function submitVote(command: {
  idempotencyKey: string;
  anonymousSubjectId: string;
  issueId: string;
  choiceId: string;
  analyticsSessionId?: string;
}) {
  return app.inject({
    method: "POST",
    url: `/v1/issues/${command.issueId}/votes`,
    headers: {
      "idempotency-key": command.idempotencyKey,
      "x-anonymous-subject-id": command.anonymousSubjectId,
      ...(command.analyticsSessionId
        ? { "x-analytics-session-id": command.analyticsSessionId }
        : {}),
    },
    payload: { issueVersion: 1, choiceId: command.choiceId },
  });
}

function findVote(command: { anonymousSubjectId: string; issueId: string }) {
  return app.inject({
    method: "GET",
    url: `/v1/issues/${command.issueId}/votes`,
    headers: { "x-anonymous-subject-id": command.anonymousSubjectId },
  });
}

function reconcileVotes(command: {
  issueId: string;
  mode?: "DRY_RUN" | "REPAIR";
  internalSecret?: string;
}) {
  return app.inject({
    method: "POST",
    url: `/v1/internal/issues/${command.issueId}/versions/1/vote-reconciliation`,
    headers: {
      "x-internal-auth-secret":
        command.internalSecret ?? getConfig({ NODE_ENV: "test" }).auth.internalSecret,
    },
    payload: command.mode ? { mode: command.mode } : {},
  });
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  app = await buildApp(getConfig({ NODE_ENV: "test" }), {
    ...database,
    issueReader: createIssueReadService(database.db),
    guestVotes: createGuestVoteService(database.db),
    commentReader: createCommentReadService(database.db),
    memberIdentity: createMemberIdentityService(database.db, {
      sessionTtlSeconds: 3_600,
      allowDevelopmentProvider: true,
    }),
  });
}, 30_000);

afterAll(async () => {
  await app.close();
  await dropDatabase();
});

describe("guest vote transaction", () => {
  it("restores the accepted Vote without creating another attempt", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const accepted = await submitVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
    });
    expect(accepted.statusCode).toBe(201);

    const restored = await findVote({ anonymousSubjectId, issueId: issue.issueId });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual(accepted.json());
    const attempts = await database.db
      .select()
      .from(voteAttempts)
      .where(eq(voteAttempts.issueId, issue.issueId));
    const storedVotes = await database.db
      .select()
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    expect(attempts).toHaveLength(1);
    expect(storedVotes).toHaveLength(1);
  });

  it("accepts a Vote without linking a missing Analytics Session", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const missingSessionId = randomUUID();

    const response = await submitVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
      analyticsSessionId: missingSessionId,
    });

    expect(response.statusCode).toBe(201);
    const [attempt] = await database.db
      .select({ analyticsSessionId: voteAttempts.analyticsSessionId })
      .from(voteAttempts)
      .where(eq(voteAttempts.issueId, issue.issueId));
    const [storedVote] = await database.db
      .select({ analyticsSessionId: votes.analyticsSessionId })
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    const [event] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));

    expect(attempt?.analyticsSessionId).toBeNull();
    expect(storedVote?.analyticsSessionId).toBeNull();
    expect(event?.payload.data).toMatchObject({ analytics_session_id: null });
  });

  it("keeps the Vote link when the Analytics Session already exists", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const analyticsSessionId = randomUUID();
    const now = new Date();
    await database.db.insert(analyticsSessions).values({
      id: analyticsSessionId,
      startedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    const response = await submitVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
      analyticsSessionId,
    });

    expect(response.statusCode).toBe(201);
    const [storedVote] = await database.db
      .select({ analyticsSessionId: votes.analyticsSessionId })
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    expect(storedVote?.analyticsSessionId).toBe(analyticsSessionId);
  });

  it("returns the exact stored response for concurrent retries with one Idempotency-Key", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const command = {
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
    };

    const [first, retry] = await Promise.all([submitVote(command), submitVote(command)]);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());

    const attempts = await database.db
      .select()
      .from(voteAttempts)
      .where(eq(voteAttempts.issueId, issue.issueId));
    const storedVotes = await database.db
      .select()
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    const snapshots = await database.db
      .select()
      .from(resultSnapshots)
      .where(eq(resultSnapshots.issueId, issue.issueId));
    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));
    const [version] = await database.db
      .select({ lockedAt: issueVersions.lockedAt })
      .from(issueVersions)
      .where(and(eq(issueVersions.issueId, issue.issueId), eq(issueVersions.version, 1)));

    expect(attempts).toHaveLength(1);
    expect(storedVotes).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("VOTE_ACCEPTED");
    expect(version?.lockedAt).toBeInstanceOf(Date);
  });

  it("accepts only one of two concurrent A/B votes from the same Guest subject", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();

    const [voteA, voteB] = await Promise.all([
      submitVote({
        idempotencyKey: randomUUID(),
        anonymousSubjectId,
        issueId: issue.issueId,
        choiceId: issue.choiceAId,
      }),
      submitVote({
        idempotencyKey: randomUUID(),
        anonymousSubjectId,
        issueId: issue.issueId,
        choiceId: issue.choiceBId,
      }),
    ]);

    expect([voteA.statusCode, voteB.statusCode].sort()).toEqual([201, 409]);
    const voteABody = voteA.json<{ outcome: string }>();
    const voteBBody = voteB.json<{ outcome: string }>();

    expect([voteABody.outcome, voteBBody.outcome].sort()).toEqual([
      "ACCEPTED",
      "REJECTED_DUPLICATE",
    ]);

    const storedVotes = await database.db
      .select({ integrityState: votes.integrityState })
      .from(votes)
      .where(eq(votes.issueId, issue.issueId));
    const [aggregate] = await database.db
      .select()
      .from(voteAggregates)
      .where(eq(voteAggregates.issueId, issue.issueId));
    const snapshots = await database.db
      .select()
      .from(resultSnapshots)
      .where(eq(resultSnapshots.issueId, issue.issueId));
    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));

    expect(storedVotes.map((vote) => vote.integrityState).sort()).toEqual([
      "ACCEPTED",
      "REJECTED_DUPLICATE",
    ]);
    expect(aggregate).toMatchObject({
      resultVersion: 2,
      voteRequestCount: 2,
      acceptedVoteCount: 1,
      displayedVoteCount: 1,
      rejectedDuplicateCount: 1,
    });
    expect(snapshots).toHaveLength(2);
    expect(events).toHaveLength(2);
  });

  it("rejects reusing an Idempotency-Key for a changed request", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const idempotencyKey = randomUUID();

    const first = await submitVote({
      idempotencyKey,
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
    });
    const conflict = await submitVote({
      idempotencyKey,
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceBId,
    });

    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps restricted Issues outside the Guest voting path", async () => {
    const issue = await createIssue({ riskLevel: "RESTRICTED" });
    const anonymousSubjectId = await createGuestSubject();

    const response = await submitVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ISSUE_NOT_VOTABLE" });

    const attempts = await database.db
      .select()
      .from(voteAttempts)
      .where(eq(voteAttempts.issueId, issue.issueId));
    expect(attempts).toHaveLength(0);
  });
});

describe("vote aggregate reconciliation", () => {
  it("requires internal authentication", async () => {
    const issue = await createIssue();

    const response = await reconcileVotes({
      issueId: issue.issueId,
      internalSecret: "invalid-internal-secret",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Internal authentication failed.",
    });
  });

  it("dry-runs by default, repairs atomically, and is idempotent on a rerun", async () => {
    const issue = await createIssue();
    const anonymousSubjectId = await createGuestSubject();
    const voteResponse = await submitVote({
      idempotencyKey: randomUUID(),
      anonymousSubjectId,
      issueId: issue.issueId,
      choiceId: issue.choiceAId,
    });
    expect(voteResponse.statusCode).toBe(201);

    await database.db
      .update(voteAggregates)
      .set({
        acceptedACount: sql`${voteAggregates.acceptedACount} + 1`,
        acceptedVoteCount: sql`${voteAggregates.acceptedVoteCount} + 1`,
        displayedVoteCount: sql`${voteAggregates.displayedVoteCount} + 1`,
      })
      .where(and(eq(voteAggregates.issueId, issue.issueId), eq(voteAggregates.issueVersion, 1)));

    const dryRun = await reconcileVotes({ issueId: issue.issueId });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({
      mode: "DRY_RUN",
      status: "MISMATCH_FOUND",
      source: {
        voteRequestCount: 1,
        acceptedACount: 1,
        acceptedBCount: 0,
        acceptedVoteCount: 1,
        displayedVoteCount: 1,
      },
      aggregateBefore: {
        resultVersion: 1,
        acceptedACount: 2,
        acceptedVoteCount: 2,
        displayedVoteCount: 2,
      },
      resultAfter: null,
    });
    expect(
      dryRun.json<{ mismatches: Array<{ target: string; field: string }> }>().mismatches,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "AGGREGATE", field: "acceptedACount" }),
        expect.objectContaining({ target: "LATEST_SNAPSHOT", field: "acceptedACount" }),
      ]),
    );

    const [afterDryRun] = await database.db
      .select()
      .from(voteAggregates)
      .where(eq(voteAggregates.issueId, issue.issueId));
    const eventsAfterDryRun = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));
    expect(afterDryRun).toMatchObject({ resultVersion: 1, acceptedACount: 2 });
    expect(eventsAfterDryRun).toHaveLength(1);

    const [repair, concurrentRepair] = await Promise.all([
      reconcileVotes({ issueId: issue.issueId, mode: "REPAIR" }),
      reconcileVotes({ issueId: issue.issueId, mode: "REPAIR" }),
    ]);
    expect(repair.statusCode).toBe(200);
    expect(concurrentRepair.statusCode).toBe(200);
    const repairBodies = [repair.json(), concurrentRepair.json()] as Array<{
      status: string;
      resultAfter: Record<string, unknown>;
    }>;
    expect(repairBodies.map((body) => body.status).sort()).toEqual(["CONSISTENT", "REPAIRED"]);
    expect(repairBodies.find((body) => body.status === "REPAIRED")).toMatchObject({
      mode: "REPAIR",
      status: "REPAIRED",
      resultAfter: {
        resultVersion: 2,
        acceptedACount: 1,
        acceptedBCount: 0,
        acceptedVoteCount: 1,
        displayedVoteCount: 1,
        integrityState: "CORRECTED",
      },
    });

    const [repairedAggregate] = await database.db
      .select()
      .from(voteAggregates)
      .where(eq(voteAggregates.issueId, issue.issueId));
    const snapshots = await database.db
      .select()
      .from(resultSnapshots)
      .where(eq(resultSnapshots.issueId, issue.issueId))
      .orderBy(desc(resultSnapshots.resultVersion));
    const rebuiltEvents = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));
    expect(repairedAggregate).toMatchObject({
      resultVersion: 2,
      acceptedACount: 1,
      acceptedVoteCount: 1,
      displayedVoteCount: 1,
      integrityState: "CORRECTED",
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      resultVersion: 2,
      acceptedACount: 1,
      displayedVoteCount: 1,
      integrityState: "CORRECTED",
    });
    expect(rebuiltEvents).toHaveLength(2);
    expect(rebuiltEvents.map((event) => event.eventType)).toContain("RESULT_AGGREGATE_REBUILT");

    const rerun = await reconcileVotes({ issueId: issue.issueId, mode: "REPAIR" });
    expect(rerun.statusCode).toBe(200);
    expect(rerun.json()).toMatchObject({
      mode: "REPAIR",
      status: "CONSISTENT",
      mismatches: [],
      resultAfter: { resultVersion: 2, integrityState: "CORRECTED" },
    });

    const finalSnapshots = await database.db
      .select()
      .from(resultSnapshots)
      .where(eq(resultSnapshots.issueId, issue.issueId));
    const finalEvents = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, `${issue.issueId}:1`));
    expect(finalSnapshots).toHaveLength(2);
    expect(finalEvents).toHaveLength(2);
  });
});
