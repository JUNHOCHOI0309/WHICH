import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  assertDevelopmentSeedAllowed,
  DEVELOPMENT_ISSUE,
  DEVELOPMENT_ISSUES,
  seedDevelopmentIssues,
} from "../src/database/development-seed.js";
import {
  issueChoices,
  issues,
  issueVersions,
  voteAggregates,
} from "../src/database/schema/index.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

type PublicIssueBody = {
  id: string;
  version: number;
  question: string;
  choices: Array<{ id: string; code: "A" | "B"; label: string }>;
  result: {
    visibility: string;
    tally: null | {
      resultVersion: number;
      acceptedA: number;
      acceptedB: number;
      displayedTotal: number;
      integrityState: string;
    };
  };
};

type IssueOverrides = Partial<
  Pick<
    typeof issues.$inferInsert,
    | "lifecycle"
    | "visibility"
    | "participation"
    | "riskLevel"
    | "isPolitical"
    | "resultVisibility"
    | "feedEligibility"
    | "voteOpenAt"
    | "voteCloseAt"
  >
>;

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createReadableIssue(
  overrides: IssueOverrides = {},
  publishedAt = new Date("2026-08-01T00:00:00.000Z"),
) {
  const issueId = randomUUID();
  const choiceAId = randomUUID();
  const choiceBId = randomUUID();

  await database.db.insert(issues).values({
    id: issueId,
    ...overrides,
  });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "Version 1 question",
    contentHash: "1".repeat(64),
    primaryCategoryCode: "TEST",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt,
  });
  await database.db.insert(issueChoices).values([
    { id: choiceAId, issueId, issueVersion: 1, code: "A", label: "First A" },
    { id: choiceBId, issueId, issueVersion: 1, code: "B", label: "First B" },
  ]);

  return { issueId, choiceAId, choiceBId };
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

describe("development Issue seed", () => {
  it("is repeatable without duplicating or replacing rows", async () => {
    await seedDevelopmentIssues(database.db);
    await database.db
      .update(issueVersions)
      .set({ question: "Locally edited seed question" })
      .where(
        and(
          eq(issueVersions.issueId, DEVELOPMENT_ISSUE.id),
          eq(issueVersions.version, DEVELOPMENT_ISSUE.version),
        ),
      );
    await seedDevelopmentIssues(database.db);

    const storedIssues = await database.db
      .select()
      .from(issues)
      .where(eq(issues.id, DEVELOPMENT_ISSUE.id));
    const allStoredIssues = await database.db
      .select({ id: issues.id })
      .from(issues)
      .where(
        inArray(
          issues.id,
          DEVELOPMENT_ISSUES.map((issue) => issue.id),
        ),
      );
    const storedVersions = await database.db
      .select()
      .from(issueVersions)
      .where(eq(issueVersions.issueId, DEVELOPMENT_ISSUE.id));
    const storedChoices = await database.db
      .select()
      .from(issueChoices)
      .where(eq(issueChoices.issueId, DEVELOPMENT_ISSUE.id));

    expect(storedIssues).toHaveLength(1);
    expect(allStoredIssues).toHaveLength(DEVELOPMENT_ISSUES.length);
    expect(storedVersions).toHaveLength(1);
    expect(storedVersions[0]?.question).toBe("Locally edited seed question");
    expect(storedChoices).toHaveLength(2);
    expect(() => assertDevelopmentSeedAllowed("production")).toThrow(
      "Development seed is disabled in production.",
    );
  });
});

describe("Guest Issue read API", () => {
  it("returns the latest published Version while hiding pre-vote result counts", async () => {
    const issue = await createReadableIssue();

    await database.db.insert(issueVersions).values([
      {
        issueId: issue.issueId,
        version: 2,
        question: "Version 2 published question",
        contentHash: "2".repeat(64),
        primaryCategoryCode: "LATEST",
        experienceModeCode: "BINARY",
        taxonomyVersion: "v1",
        publishedAt: new Date("2026-08-10T00:00:00.000Z"),
      },
      {
        issueId: issue.issueId,
        version: 3,
        question: "Version 3 draft question",
        contentHash: "3".repeat(64),
        primaryCategoryCode: "DRAFT",
        experienceModeCode: "BINARY",
        taxonomyVersion: "v1",
      },
    ]);
    await database.db.insert(issueChoices).values([
      {
        id: randomUUID(),
        issueId: issue.issueId,
        issueVersion: 2,
        code: "A",
        label: "Latest A",
      },
      {
        id: randomUUID(),
        issueId: issue.issueId,
        issueVersion: 2,
        code: "B",
        label: "Latest B",
      },
      {
        id: randomUUID(),
        issueId: issue.issueId,
        issueVersion: 3,
        code: "A",
        label: "Draft A",
      },
      {
        id: randomUUID(),
        issueId: issue.issueId,
        issueVersion: 3,
        code: "B",
        label: "Draft B",
      },
    ]);
    await database.db.insert(voteAggregates).values({
      issueId: issue.issueId,
      issueVersion: 2,
      resultVersion: 1,
      voteRequestCount: 3,
      acceptedACount: 2,
      acceptedBCount: 1,
      acceptedVoteCount: 3,
      displayedVoteCount: 3,
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}`,
    });
    const body = response.json<PublicIssueBody>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      id: issue.issueId,
      version: 2,
      question: "Version 2 published question",
      choices: [
        { code: "A", label: "Latest A" },
        { code: "B", label: "Latest B" },
      ],
      result: { visibility: "PRE_VOTE_HIDDEN", tally: null },
    });
    expect(JSON.stringify(body)).not.toContain("riskLevel");
    expect(JSON.stringify(body)).not.toContain("contentHash");
  });

  it("returns an Aggregate only when results are visible", async () => {
    const issue = await createReadableIssue({ resultVisibility: "RESULT_VISIBLE" });
    await database.db.insert(voteAggregates).values({
      issueId: issue.issueId,
      issueVersion: 1,
      resultVersion: 4,
      voteRequestCount: 7,
      acceptedACount: 4,
      acceptedBCount: 3,
      acceptedVoteCount: 7,
      displayedVoteCount: 7,
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/issues/${issue.issueId}`,
    });
    const body = response.json<PublicIssueBody>();

    expect(response.statusCode).toBe(200);
    expect(body.result).toEqual({
      visibility: "RESULT_VISIBLE",
      tally: {
        resultVersion: 4,
        acceptedA: 4,
        acceptedB: 3,
        displayedTotal: 7,
        integrityState: "NORMAL",
      },
    });
  });

  it("rejects Issues that are not available to Guests", async () => {
    const unavailableIssues = await Promise.all([
      createReadableIssue({ visibility: "LIMITED" }),
      createReadableIssue({ participation: "VOTING_CLOSED" }),
      createReadableIssue({ lifecycle: "CLOSED" }),
      createReadableIssue({ riskLevel: "RESTRICTED" }),
      createReadableIssue({ riskLevel: "RESTRICTED", isPolitical: true }),
      createReadableIssue({
        voteOpenAt: new Date("2026-07-01T00:00:00.000Z"),
        voteCloseAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ]);

    const responses = await Promise.all(
      unavailableIssues.map((issue) =>
        app.inject({ method: "GET", url: `/v1/issues/${issue.issueId}` }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "ISSUE_NOT_AVAILABLE" });
    }
  });

  it("distinguishes a missing Issue from an unavailable one", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/issues/${randomUUID()}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "ISSUE_NOT_FOUND" });
  });

  it("returns unavailable when the current Version has an incomplete Choice set", async () => {
    const issue = await createReadableIssue();
    await database.db
      .delete(issueChoices)
      .where(and(eq(issueChoices.issueId, issue.issueId), eq(issueChoices.code, "B")));

    const response = await app.inject({ method: "GET", url: `/v1/issues/${issue.issueId}` });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ISSUE_NOT_AVAILABLE" });
  });
});

describe("Guest Issue feed API", () => {
  it("paginates with a stable publishedAt and Issue ID cursor", async () => {
    const now = Date.now();
    const newest = await createReadableIssue({}, new Date(now - 60_000));
    const middle = await createReadableIssue({}, new Date(now - 120_000));
    const oldest = await createReadableIssue({}, new Date(now - 180_000));

    const firstResponse = await app.inject({ method: "GET", url: "/v1/issues/feed?limit=2" });
    const firstPage = firstResponse.json<{
      items: Array<{ id: string; choices: Array<{ code: string }> }>;
      nextCursor: string | null;
    }>();

    expect(firstResponse.statusCode).toBe(200);
    expect(firstPage.items.map((item) => item.id)).toEqual([newest.issueId, middle.issueId]);
    expect(
      firstPage.items.every((item) => item.choices.map((choice) => choice.code).join("") === "AB"),
    ).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/feed?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = secondResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();

    expect(secondResponse.statusCode).toBe(200);
    expect(secondPage.items[0]?.id).toBe(oldest.issueId);
    expect(secondPage.items.map((item) => item.id)).not.toContain(newest.issueId);
    expect(secondPage.items.map((item) => item.id)).not.toContain(middle.issueId);
  });

  it("excludes the current Issue and Issues already accepted for the Guest", async () => {
    const now = Date.now();
    const votedIssue = await createReadableIssue({}, new Date(now - 10_000));
    const currentIssue = await createReadableIssue({}, new Date(now - 20_000));
    const nextIssue = await createReadableIssue({}, new Date(now - 30_000));
    const subjectResponse = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
    const subject = subjectResponse.json<{ anonymousSubjectId: string }>();

    const voteResponse = await app.inject({
      method: "POST",
      url: `/v1/issues/${votedIssue.issueId}/votes`,
      headers: {
        "idempotency-key": randomUUID(),
        "x-anonymous-subject-id": subject.anonymousSubjectId,
      },
      payload: { issueVersion: 1, choiceId: votedIssue.choiceAId },
    });
    expect(voteResponse.statusCode).toBe(201);

    const feedResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/feed?limit=20&excludeIssueId=${currentIssue.issueId}`,
      headers: { "x-anonymous-subject-id": subject.anonymousSubjectId },
    });
    const feed = feedResponse.json<{ items: Array<{ id: string }> }>();

    expect(feedResponse.statusCode).toBe(200);
    expect(feed.items.map((item) => item.id)).toContain(nextIssue.issueId);
    expect(feed.items.map((item) => item.id)).not.toContain(votedIssue.issueId);
    expect(feed.items.map((item) => item.id)).not.toContain(currentIssue.issueId);
  });

  it("rejects invalid cursors and omits Feed-ineligible Issues", async () => {
    const hidden = await createReadableIssue({ feedEligibility: "EXCLUDED" }, new Date());
    const feedResponse = await app.inject({ method: "GET", url: "/v1/issues/feed?limit=20" });
    const invalidCursorResponse = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?cursor=not-a-cursor",
    });

    expect(
      feedResponse.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id),
    ).not.toContain(hidden.issueId);
    expect(invalidCursorResponse.statusCode).toBe(400);
    expect(invalidCursorResponse.json()).toMatchObject({ code: "INVALID_CURSOR" });
  });
});
