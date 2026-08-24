import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  guestMemberLinks,
  interestProfiles,
  issueChoices,
  issueInterestCards,
  issues,
  issueVersions,
  memberSessions,
  members,
  recommendationItems,
  recommendationRequests,
  subjectInterests,
  voterSubjects,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createIssue(cardCode: string, publishedAt: Date) {
  const issueId = randomUUID();
  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: `${cardCode} question`,
    contentHash: createHash("sha256").update(issueId).digest("hex"),
    primaryCategoryCode: cardCode,
    experienceModeCode: "BINARY",
    taxonomyVersion: "taxonomy_v2.0",
    publishedAt,
  });
  await database.db.insert(issueChoices).values([
    { issueId, issueVersion: 1, code: "A", label: "A" },
    { issueId, issueVersion: 1, code: "B", label: "B" },
  ]);
  await database.db.insert(issueInterestCards).values({
    issueId,
    issueVersion: 1,
    cardCode,
    taxonomyVersion: "interest_cards_v1",
    weight: 100,
  });
  return issueId;
}

async function createGuestProfile(cardCodes: string[], state = "COMPLETED") {
  const anonymousSubjectId = randomUUID();
  const subjectId = randomUUID();
  await database.db.insert(voterSubjects).values({
    id: subjectId,
    kind: "GUEST",
    anonymousSubjectId,
  });
  await database.db.insert(interestProfiles).values({
    subjectId,
    onboardingState: state,
    taxonomyVersion: "interest_cards_v1",
  });
  if (cardCodes.length > 0) {
    await database.db
      .insert(subjectInterests)
      .values(cardCodes.map((cardCode) => ({ subjectId, cardCode, source: "EXPLICIT" })));
  }
  return { anonymousSubjectId, subjectId };
}

async function voteOnIssue(
  issueId: string,
  headers: { authorization?: string; "x-anonymous-subject-id"?: string },
) {
  const [choice] = await database.db
    .select({ id: issueChoices.id })
    .from(issueChoices)
    .where(eq(issueChoices.issueId, issueId))
    .limit(1);
  const response = await app.inject({
    method: "POST",
    url: `/v1/issues/${issueId}/votes`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { issueVersion: 1, choiceId: choice!.id },
  });
  expect(response.statusCode).toBe(201);
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  app = await buildApp(getConfig({ NODE_ENV: "test" }), {
    ...database,
    issueReader: createIssueReadService(database.db, { personalizationEnabled: true }),
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

describe("Personalized Feed Ranker v0", () => {
  it("prioritizes explicit Interest matches and keeps personalized pagination stable", async () => {
    const newestFood = await createIssue("FOOD", new Date("2026-08-20T16:00:00.000Z"));
    const olderTech = await createIssue("TECH", new Date("2026-08-20T15:00:00.000Z"));
    const oldestTravel = await createIssue("TRAVEL", new Date("2026-08-20T14:00:00.000Z"));
    const guest = await createGuestProfile(["TECH", "GAME", "MOVIE_DRAMA"]);

    const firstResponse = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=1",
      headers: { "x-anonymous-subject-id": guest.anonymousSubjectId },
    });
    const first = firstResponse.json<{
      items: Array<{
        id: string;
        recommendation: { requestId: string; matchedCardCodes: string[] };
      }>;
      nextCursor: string;
      ranking: { mode: string; reasonCode: string; profileVersion: number };
    }>();

    expect(firstResponse.statusCode).toBe(200);
    expect(first.ranking).toMatchObject({
      mode: "PERSONALIZED",
      reasonCode: "INTEREST_PROFILE_MATCH",
      profileVersion: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.id).toBe(olderTech);
    expect(first.items[0]?.recommendation.matchedCardCodes).toEqual(["TECH"]);
    const [recordedRequest] = await database.db
      .select({ mode: recommendationRequests.rankingMode })
      .from(recommendationRequests)
      .where(eq(recommendationRequests.id, first.items[0]!.recommendation.requestId));
    const recordedItems = await database.db
      .select({ issueId: recommendationItems.issueId })
      .from(recommendationItems)
      .where(eq(recommendationItems.requestId, first.items[0]!.recommendation.requestId));
    expect(recordedRequest?.mode).toBe("PERSONALIZED");
    expect(recordedItems).toEqual([{ issueId: olderTech }]);

    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/feed?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: { "x-anonymous-subject-id": guest.anonymousSubjectId },
    });
    const second = secondResponse.json<{ items: Array<{ id: string }> }>();
    expect(secondResponse.statusCode).toBe(200);
    expect(second.items).toHaveLength(2);
    expect(second.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([newestFood, oldestTravel]),
    );
    expect(second.items.map((item) => item.id)).not.toContain(olderTech);
  });

  it("keeps recency order when the Interest Profile is not completed", async () => {
    const older = await createIssue("GAME", new Date("2026-08-20T12:00:00.000Z"));
    const newer = await createIssue("FOOD", new Date("2026-08-20T13:00:00.000Z"));
    const guest = await createGuestProfile([], "SKIPPED");

    const response = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=20",
      headers: { "x-anonymous-subject-id": guest.anonymousSubjectId },
    });
    const body = response.json<{ items: Array<{ id: string }>; ranking: { mode: string } }>();
    expect(response.statusCode).toBe(200);
    expect(body.ranking.mode).toBe("RECENCY");
    expect(body.items.findIndex((item) => item.id === newer)).toBeLessThan(
      body.items.findIndex((item) => item.id === older),
    );
  });

  it("falls back to recency while the ranker feature flag is disabled", async () => {
    const guest = await createGuestProfile(["TECH", "GAME", "MOVIE_DRAMA"]);
    const feed = await createIssueReadService(database.db, {
      personalizationEnabled: false,
    }).listGuestIssues({ anonymousSubjectId: guest.anonymousSubjectId, limit: 2 });

    expect(feed.ranking).toMatchObject({ mode: "RECENCY", reasonCode: "FEATURE_DISABLED" });
    expect(feed.items.every((item) => item.recommendation.score === 0)).toBe(true);
  });

  it("rejects a personalized cursor after the Interest Profile version changes", async () => {
    const guest = await createGuestProfile(["TECH", "GAME", "MOVIE_DRAMA"]);
    const firstResponse = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=1",
      headers: { "x-anonymous-subject-id": guest.anonymousSubjectId },
    });
    const first = firstResponse.json<{ nextCursor: string }>();
    await database.db
      .update(interestProfiles)
      .set({ profileVersion: 2 })
      .where(eq(interestProfiles.subjectId, guest.subjectId));

    const staleResponse = await app.inject({
      method: "GET",
      url: `/v1/issues/feed?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: { "x-anonymous-subject-id": guest.anonymousSubjectId },
    });

    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({ code: "STALE_RANKING_CURSOR" });
  });

  it("uses the Member Profile when a valid session is supplied", async () => {
    const memberId = randomUUID();
    const memberSubjectId = randomUUID();
    const sessionToken = "member-feed-session-token";
    await database.db.insert(members).values({ id: memberId, displayName: "Member" });
    await database.db.insert(voterSubjects).values({
      id: memberSubjectId,
      kind: "MEMBER",
      userId: memberId,
    });
    await database.db.insert(memberSessions).values({
      memberId,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await database.db.insert(interestProfiles).values({
      subjectId: memberSubjectId,
      onboardingState: "COMPLETED",
      taxonomyVersion: "interest_cards_v1",
    });
    await database.db.insert(subjectInterests).values([
      { subjectId: memberSubjectId, cardCode: "EDUCATION" },
      { subjectId: memberSubjectId, cardCode: "SOCIETY" },
      { subjectId: memberSubjectId, cardCode: "WORK" },
    ]);
    const educationIssue = await createIssue("EDUCATION", new Date("2026-08-20T00:00:00.000Z"));

    const response = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=1",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const body = response.json<{ items: Array<{ id: string }>; ranking: { mode: string } }>();
    expect(response.statusCode).toBe(200);
    expect(body.ranking.mode).toBe("PERSONALIZED");
    expect(body.items[0]?.id).toBe(educationIssue);
  });

  it("excludes the Member's direct, linked Guest, and current unlinked Guest votes", async () => {
    const memberId = randomUUID();
    const memberSubjectId = randomUUID();
    const sessionToken = `member-feed-${randomUUID()}`;
    await database.db.insert(members).values({ id: memberId, displayName: "Feed Member" });
    await database.db.insert(voterSubjects).values({
      id: memberSubjectId,
      kind: "MEMBER",
      userId: memberId,
    });
    await database.db.insert(memberSessions).values({
      memberId,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await database.db.insert(interestProfiles).values({
      subjectId: memberSubjectId,
      onboardingState: "COMPLETED",
      taxonomyVersion: "interest_cards_v1",
    });
    await database.db.insert(subjectInterests).values([
      { subjectId: memberSubjectId, cardCode: "EDUCATION" },
      { subjectId: memberSubjectId, cardCode: "SOCIETY" },
      { subjectId: memberSubjectId, cardCode: "WORK" },
    ]);

    const directIssue = await createIssue("EDUCATION", new Date("2026-08-21T05:00:00.000Z"));
    const linkedGuestIssue = await createIssue("EDUCATION", new Date("2026-08-21T04:00:00.000Z"));
    const currentGuestIssue = await createIssue("EDUCATION", new Date("2026-08-21T03:00:00.000Z"));
    const foreignGuestIssue = await createIssue("EDUCATION", new Date("2026-08-21T02:00:00.000Z"));
    const unseenIssue = await createIssue("EDUCATION", new Date("2026-08-21T01:00:00.000Z"));

    await voteOnIssue(directIssue, { authorization: `Bearer ${sessionToken}` });

    const linkedGuest = await createGuestProfile([], "SKIPPED");
    await voteOnIssue(linkedGuestIssue, {
      "x-anonymous-subject-id": linkedGuest.anonymousSubjectId,
    });
    await database.db.insert(guestMemberLinks).values({
      guestSubjectId: linkedGuest.subjectId,
      memberSubjectId,
      memberId,
      provider: "DEVELOPMENT",
    });

    const currentGuest = await createGuestProfile([], "SKIPPED");
    await voteOnIssue(currentGuestIssue, {
      "x-anonymous-subject-id": currentGuest.anonymousSubjectId,
    });

    const foreignMemberId = randomUUID();
    const foreignMemberSubjectId = randomUUID();
    const foreignGuest = await createGuestProfile([], "SKIPPED");
    await database.db.insert(members).values({
      id: foreignMemberId,
      displayName: "Other Feed Member",
    });
    await database.db.insert(voterSubjects).values({
      id: foreignMemberSubjectId,
      kind: "MEMBER",
      userId: foreignMemberId,
    });
    await database.db.insert(guestMemberLinks).values({
      guestSubjectId: foreignGuest.subjectId,
      memberSubjectId: foreignMemberSubjectId,
      memberId: foreignMemberId,
      provider: "DEVELOPMENT",
    });
    await voteOnIssue(foreignGuestIssue, {
      "x-anonymous-subject-id": foreignGuest.anonymousSubjectId,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=20",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "x-anonymous-subject-id": currentGuest.anonymousSubjectId,
      },
    });
    const body = response.json<{ items: Array<{ id: string }>; ranking: { mode: string } }>();
    const issueIds = body.items.map((item) => item.id);

    expect(response.statusCode).toBe(200);
    expect(body.ranking.mode).toBe("PERSONALIZED");
    expect(issueIds).not.toContain(directIssue);
    expect(issueIds).not.toContain(linkedGuestIssue);
    expect(issueIds).not.toContain(currentGuestIssue);
    expect(issueIds).toContain(foreignGuestIssue);
    expect(issueIds).toContain(unseenIssue);

    const recencyFeed = await createIssueReadService(database.db, {
      personalizationEnabled: false,
    }).listGuestIssues({
      sessionToken,
      anonymousSubjectId: currentGuest.anonymousSubjectId,
      limit: 20,
    });
    const recencyIssueIds = recencyFeed.items.map((item) => item.id);
    expect(recencyFeed.ranking.mode).toBe("RECENCY");
    expect(recencyIssueIds).not.toContain(directIssue);
    expect(recencyIssueIds).not.toContain(linkedGuestIssue);
    expect(recencyIssueIds).not.toContain(currentGuestIssue);
    expect(recencyIssueIds).toContain(foreignGuestIssue);
    expect(recencyIssueIds).toContain(unseenIssue);

    const foreignCookieResponse = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=20",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "x-anonymous-subject-id": foreignGuest.anonymousSubjectId,
      },
    });
    expect(
      foreignCookieResponse.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id),
    ).toContain(foreignGuestIssue);
  });
});
