import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
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
}) {
  return app.inject({
    method: "POST",
    url: `/v1/issues/${command.issueId}/votes`,
    headers: {
      "idempotency-key": command.idempotencyKey,
      "x-anonymous-subject-id": command.anonymousSubjectId,
    },
    payload: { issueVersion: 1, choiceId: command.choiceId },
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
