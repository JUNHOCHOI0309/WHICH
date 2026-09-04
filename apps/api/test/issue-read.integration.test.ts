import { createHash, randomUUID } from "node:crypto";

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
  comments,
  issueChoices,
  issueChoiceMedia,
  issueMediaAssets,
  issueRecommendations,
  issues,
  issueVersions,
  members,
  memberSessions,
  recommendationRequests,
  voterSubjects,
  votes,
  voteAggregates,
} from "../src/database/schema/index.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createIssueRecommendationService } from "../src/modules/issue-recommendations/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

type PublicIssueBody = {
  id: string;
  version: number;
  question: string;
  mediaMode: "TEXT_ONLY" | "OPTION_IMAGES";
  choices: Array<{
    id: string;
    code: "A" | "B";
    label: string;
    media: null | { url: string; altText: string; cropMode: "COVER" | "CONTAIN" };
  }>;
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
    issueRecommendations: createIssueRecommendationService(database.db),
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
  it("exposes only a complete approved image pair to an assigned viewer", async () => {
    const issue = await createReadableIssue();
    const operatorId = randomUUID();
    const assetAId = randomUUID();
    const assetBId = randomUUID();
    await database.db.insert(members).values({ id: operatorId, displayName: "Media Operator" });
    await database.db
      .update(issueVersions)
      .set({ mediaMode: "OPTION_IMAGES" })
      .where(and(eq(issueVersions.issueId, issue.issueId), eq(issueVersions.version, 1)));
    const asset = (id: string, hashCharacter: string, objectKey: string) => ({
      id,
      uploadedByMemberId: operatorId,
      sourceType: "OPERATOR_UPLOAD",
      rightsAttestation: "Documented publication rights for this integration fixture.",
      rightsAttestedAt: new Date(),
      sha256: hashCharacter.repeat(64),
      perceptualHash: hashCharacter.repeat(16),
      inputMimeType: "image/png",
      inputByteSize: 100,
      inputWidth: 1200,
      inputHeight: 675,
      outputByteSize: 80,
      outputWidth: 1200,
      outputHeight: 675,
      processingState: "READY",
      moderationState: "APPROVED",
      storageState: "PUBLISHED",
      rightsState: "ASSERTED",
      publishedObjectKey: objectKey,
      publishedAt: new Date(),
    });
    await database.db
      .insert(issueMediaAssets)
      .values([asset(assetAId, "a", "published/a.webp"), asset(assetBId, "b", "published/b.webp")]);
    await database.db.insert(issueChoiceMedia).values([
      {
        issueId: issue.issueId,
        issueVersion: 1,
        choiceId: issue.choiceAId,
        mediaAssetId: assetAId,
        altText: "A option image",
        cropMode: "COVER",
        displayPosition: 0,
        linkedByMemberId: operatorId,
      },
      {
        issueId: issue.issueId,
        issueVersion: 1,
        choiceId: issue.choiceBId,
        mediaAssetId: assetBId,
        altText: "B option image",
        cropMode: "CONTAIN",
        displayPosition: 1,
        linkedByMemberId: operatorId,
      },
    ]);

    const enabledReader = createIssueReadService(database.db, {
      mediaExperiment: {
        enabled: true,
        exposurePercent: 100,
        publicUrl: (key) => `https://media.which.test/${key}`,
      },
    });
    const exposed = await enabledReader.getGuestIssue(issue.issueId, {
      anonymousSubjectId: randomUUID(),
    });
    expect(exposed).toMatchObject({
      mediaMode: "OPTION_IMAGES",
      choices: [
        { media: { url: "https://media.which.test/published/a.webp", altText: "A option image" } },
        { media: { url: "https://media.which.test/published/b.webp", altText: "B option image" } },
      ],
    });

    await database.db
      .update(issueMediaAssets)
      .set({ moderationState: "REVOKED" })
      .where(eq(issueMediaAssets.id, assetBId));
    const fallback = await enabledReader.getGuestIssue(issue.issueId, {
      anonymousSubjectId: randomUUID(),
    });
    expect(fallback).toMatchObject({
      mediaMode: "TEXT_ONLY",
      choices: [{ media: null }, { media: null }],
    });
  });

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
        acceptedC: 0,
        acceptedD: 0,
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

describe("public Issue discovery catalog API", () => {
  it("returns a bounded newest-first safe catalog without recommendation audit writes", async () => {
    const now = Date.now();
    const older = await createReadableIssue({}, new Date(now - 2_000));
    const newer = await createReadableIssue({}, new Date(now - 1_000));
    const excluded = await Promise.all([
      createReadableIssue({ feedEligibility: "EXCLUDED" }, new Date(now - 100)),
      createReadableIssue({ riskLevel: "MEDIUM" }, new Date(now - 200)),
      createReadableIssue({ riskLevel: "RESTRICTED", isPolitical: true }, new Date(now - 300)),
      createReadableIssue({ visibility: "LIMITED" }, new Date(now - 400)),
      createReadableIssue({ participation: "VOTING_CLOSED" }, new Date(now - 500)),
      createReadableIssue({ lifecycle: "CLOSED" }, new Date(now - 600)),
      createReadableIssue({ voteOpenAt: new Date(now + 60_000) }, new Date(now - 700)),
      createReadableIssue(
        { voteOpenAt: new Date(now - 60_000), voteCloseAt: new Date(now - 30_000) },
        new Date(now - 800),
      ),
    ]);
    await database.db
      .update(issueVersions)
      .set({ context: "검색 결과에서 질문의 전제를 이해할 수 있는 충분한 공개 설명입니다." })
      .where(inArray(issueVersions.issueId, [older.issueId, newer.issueId]));

    const auditBefore = await database.db
      .select({ id: recommendationRequests.id })
      .from(recommendationRequests);
    const response = await app.inject({ method: "GET", url: "/v1/issues/catalog?limit=2" });
    const auditAfter = await database.db
      .select({ id: recommendationRequests.id })
      .from(recommendationRequests);
    const body = response.json<{
      items: Array<{
        id: string;
        version: number;
        question: string;
        context: string | null;
        publishedAt: string;
        categoryCode: string;
        choices: Array<{ code: "A" | "B"; label: string; media: null }>;
      }>;
    }>();
    await database.db
      .delete(issues)
      .where(
        inArray(issues.id, [
          older.issueId,
          newer.issueId,
          ...excluded.map((issue) => issue.issueId),
        ]),
      );

    expect(response.statusCode).toBe(200);
    expect(body.items.map((item) => item.id)).toEqual([newer.issueId, older.issueId]);
    expect(body.items[0]).toMatchObject({
      context: "검색 결과에서 질문의 전제를 이해할 수 있는 충분한 공개 설명입니다.",
      categoryCode: "TEST",
      choices: [
        { code: "A", label: "First A", media: null },
        { code: "B", label: "First B", media: null },
      ],
    });
    expect(body.items.some((item) => excluded.some((issue) => issue.issueId === item.id))).toBe(
      false,
    );
    expect(auditAfter).toHaveLength(auditBefore.length);
  });

  it("rejects catalog limits above the public discovery bound", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/issues/catalog?limit=501" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("Guest Issue feed API", () => {
  it("shows public engagement counts and stores one recommendation per Member", async () => {
    const issue = await createReadableIssue({}, new Date("2025-01-01T00:00:00.000Z"));
    const memberId = randomUUID();
    const sessionToken = `recommend-${randomUUID()}`;
    await database.db
      .insert(members)
      .values({ id: memberId, displayName: "Recommendation Member" });
    await database.db.insert(voterSubjects).values({ kind: "MEMBER", userId: memberId });
    await database.db.insert(memberSessions).values({
      memberId,
      tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const first = await app.inject({
      method: "PUT",
      url: `/v1/issues/${issue.issueId}/recommendation`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { active: true },
    });
    const duplicate = await app.inject({
      method: "PUT",
      url: `/v1/issues/${issue.issueId}/recommendation`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { active: true },
    });
    const guestResponse = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
    const anonymousSubjectId = guestResponse.json<{ anonymousSubjectId: string }>()
      .anonymousSubjectId;
    const guestVote = await app.inject({
      method: "POST",
      url: `/v1/issues/${issue.issueId}/votes`,
      headers: {
        "idempotency-key": randomUUID(),
        "x-anonymous-subject-id": anonymousSubjectId,
      },
      payload: { issueVersion: 1, choiceId: issue.choiceAId },
    });
    expect(guestVote.statusCode).toBe(201);
    const [guestSubject] = await database.db
      .select({ id: voterSubjects.id })
      .from(voterSubjects)
      .where(eq(voterSubjects.anonymousSubjectId, anonymousSubjectId))
      .limit(1);
    const [acceptedVote] = await database.db
      .select({ id: votes.id })
      .from(votes)
      .where(and(eq(votes.issueId, issue.issueId), eq(votes.subjectId, guestSubject!.id)))
      .limit(1);
    await database.db.insert(comments).values([
      {
        issueId: issue.issueId,
        issueVersion: 1,
        authorSubjectId: guestSubject!.id,
        acceptedVoteId: acceptedVote!.id,
        choice: "A",
        authorDisplayName: "공개 댓글러",
        body: "집계되어야 하는 공개 댓글",
        publicationState: "PUBLISHED",
      },
      {
        issueId: issue.issueId,
        issueVersion: 1,
        authorSubjectId: guestSubject!.id,
        acceptedVoteId: acceptedVote!.id,
        choice: "A",
        authorDisplayName: "검수 대기 댓글러",
        body: "집계되면 안 되는 검수 대기 댓글",
        publicationState: "PENDING_AUTOMOD",
      },
    ]);
    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/issues/feed?limit=20",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const feedItem = feedResponse
      .json<{
        items: Array<{
          id: string;
          engagement: {
            recommendationCount: number;
            commentCount: number;
            viewerRecommended: boolean;
          };
        }>;
      }>()
      .items.find((item) => item.id === issue.issueId);
    const stored = await database.db
      .select()
      .from(issueRecommendations)
      .where(eq(issueRecommendations.issueId, issue.issueId));

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ recommendation: { active: true, count: 1 } });
    expect(duplicate.json()).toEqual({ recommendation: { active: true, count: 1 } });
    expect(stored).toHaveLength(1);
    expect(feedItem?.engagement).toEqual({
      recommendationCount: 1,
      commentCount: 1,
      viewerRecommended: true,
    });

    const removed = await app.inject({
      method: "PUT",
      url: `/v1/issues/${issue.issueId}/recommendation`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { active: false },
    });
    expect(removed.json()).toEqual({ recommendation: { active: false, count: 0 } });
  });

  it("returns a result-free participation rail ordered by recent valid votes", async () => {
    const popular = await createReadableIssue({}, new Date("2026-07-01T00:00:00.000Z"));
    await createReadableIssue({}, new Date("2026-07-02T00:00:00.000Z"));

    for (let index = 0; index < 2; index += 1) {
      const subjectResponse = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
      const subject = subjectResponse.json<{ anonymousSubjectId: string }>();
      const voteResponse = await app.inject({
        method: "POST",
        url: `/v1/issues/${popular.issueId}/votes`,
        headers: {
          "idempotency-key": randomUUID(),
          "x-anonymous-subject-id": subject.anonymousSubjectId,
        },
        payload: { issueVersion: 1, choiceId: popular.choiceAId },
      });
      expect(voteResponse.statusCode).toBe(201);
    }

    const response = await app.inject({ method: "GET", url: "/v1/issues/feed?limit=1" });
    const body = response.json<{
      rightRail: {
        version: string;
        items: Array<{
          issueId: string;
          participationCount: number;
          reasonCode: string;
          acceptedA?: number;
          acceptedB?: number;
        }>;
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.rightRail.version).toBe("participation_v1");
    expect(body.rightRail.items[0]).toMatchObject({
      issueId: popular.issueId,
      participationCount: 2,
      reasonCode: "RECENT_PARTICIPATION",
    });
    expect(body.rightRail.items).toHaveLength(3);
    expect(body.rightRail.items.some((item) => item.reasonCode === "RECENT_FALLBACK")).toBe(true);
    expect(JSON.stringify(body.rightRail)).not.toContain("acceptedA");
    expect(JSON.stringify(body.rightRail)).not.toContain("acceptedB");
  });

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
    expect(
      feedResponse
        .json<{ rightRail: { items: Array<{ issueId: string }> } }>()
        .rightRail.items.map((item) => item.issueId),
    ).not.toContain(votedIssue.issueId);
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
