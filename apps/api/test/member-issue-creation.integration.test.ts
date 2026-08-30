import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  issueAuthors,
  issueChoiceMedia,
  issueChoices,
  issueInterestCards,
  issueMediaAssets,
  issueMediaLibraryAssets,
  issueMediaLibraryPairs,
  issueMediaLibraryUsages,
  issueVersions,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  memberModerationNotices,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import {
  createIssueWriteService,
  reconcileReviewedIssueSubmissions,
} from "../src/modules/issues/creation-service.js";
import type { MemberIssueSubmission } from "../src/modules/issues/contracts.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "member-issue-creation-test-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createSession(displayName = "질문 만드는 회원") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject: randomUUID(),
      displayName,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string; member: { id: string } }>();
}

function createPayload(question: string) {
  return {
    question,
    context: "오늘 저녁의 가벼운 선택",
    choiceA: "바로 자기",
    choiceB: "조금 더 놀기",
    interestCardCode: "DAILY_LIFE",
  };
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  app = await buildApp(getConfig({ NODE_ENV: "test", INTERNAL_AUTH_SECRET: INTERNAL_SECRET }), {
    ...database,
    issueReader: createIssueReadService(database.db),
    issueWriter: createIssueWriteService(database.db),
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

describe("Member Issue creation v1", () => {
  it("authenticates actions and returns the publication state through the route contract", async () => {
    const session = await createSession();
    const first = (
      await createIssueWriteService(database.db).submitMemberIssue({
        ...createPayload("쉬는 날에는 무엇을 할까"),
        interestCardCode: "DAILY_LIFE",
        sessionToken: session.token,
        idempotencyKey: randomUUID(),
      })
    ).submission;
    const request = {
      method: "POST" as const,
      url: `/v1/member/issue-submissions/${first.id}/actions`,
      payload: { expectedRevision: 1, action: "TEXT_ONLY" },
    };
    expect((await app.inject(request)).statusCode).toBe(401);
    const response = await app.inject({
      ...request,
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      submission: {
        status: "APPROVED",
        publicationState: "PUBLISHED",
        revision: 2,
      },
      created: true,
    });
    expect(
      typeof response.json<{ submission: MemberIssueSubmission }>().submission.publishedIssueId,
    ).toBe("string");
  });
  it("publishes a pending text conversion once without charging the quota twice", async () => {
    const session = await createSession();
    const writer = createIssueWriteService(database.db);
    const command = {
      ...createPayload("저녁에는 무엇을 하면 좋을까"),
      interestCardCode: "DAILY_LIFE" as const,
      sessionToken: session.token,
      idempotencyKey: randomUUID(),
    };
    const first = (await writer.submitMemberIssue(command)).submission;
    await writer.submitMemberIssue({ ...command, idempotencyKey: randomUUID() });
    await writer.submitMemberIssue({ ...command, idempotencyKey: randomUUID() });
    const action = {
      sessionToken: session.token,
      submissionId: first.id,
      expectedRevision: 1,
      action: "TEXT_ONLY" as const,
    };
    const results = await Promise.all([
      writer.actOnMemberIssueSubmission(action),
      writer.actOnMemberIssueSubmission(action),
    ]);
    expect(results[0].submission.publishedIssueId).toBeTruthy();
    expect(results[0].submission.publishedIssueId).toBe(results[1].submission.publishedIssueId);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].submission.publicationState).toBe("PUBLISHED");
    expect(
      await database.db
        .select()
        .from(issueAuthors)
        .where(eq(issueAuthors.memberId, session.member.id)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(memberModerationNotices)
        .where(eq(memberModerationNotices.memberId, session.member.id)),
    ).toHaveLength(1);
    await expect(
      writer.createMemberIssue({ ...command, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "ISSUE_CREATION_LIMIT_REACHED" });
  });

  it("rejects foreign and stale actions, preserves cancellation and rejects direct-image bypass", async () => {
    const session = await createSession();
    const other = await createSession();
    const writer = createIssueWriteService(database.db);
    const command = {
      ...createPayload("잠들기 전에 무엇을 할까"),
      interestCardCode: "DAILY_LIFE" as const,
      sessionToken: session.token,
      idempotencyKey: randomUUID(),
    };
    const first = (await writer.submitMemberIssue(command)).submission;
    const action = {
      sessionToken: session.token,
      submissionId: first.id,
      expectedRevision: 1,
      action: "CANCEL" as const,
    };
    await expect(
      writer.actOnMemberIssueSubmission({ ...action, sessionToken: other.token }),
    ).rejects.toMatchObject({ code: "ISSUE_SUBMISSION_NOT_FOUND" });
    await expect(
      writer.actOnMemberIssueSubmission({ ...action, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "ISSUE_SUBMISSION_REVISION_CONFLICT" });
    const cancelled = await writer.actOnMemberIssueSubmission(action);
    expect(cancelled.submission).toMatchObject({
      revision: 2,
      status: "CANCELLED",
      publicationState: "CANCELLED",
      publishedIssueId: null,
    });
    expect((await writer.actOnMemberIssueSubmission(action)).created).toBe(false);
    await expect(
      writer.resubmitMemberIssue({
        ...command,
        idempotencyKey: randomUUID(),
        submissionId: first.id,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "ISSUE_SUBMISSION_NOT_EDITABLE" });
    await expect(
      writer.actOnMemberIssueSubmission({ ...action, expectedRevision: 2, action: "TEXT_ONLY" }),
    ).rejects.toMatchObject({ code: "ISSUE_SUBMISSION_NOT_EDITABLE" });
    await expect(
      writer.createMemberIssue({
        ...command,
        mediaAssetAId: randomUUID(),
        mediaAssetBId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ISSUE_SUBMISSION_MEDIA_INVALID" });
  });

  it("waits for both images, publishes once after approval, and never publishes a cancelled submission", async () => {
    const session = await createSession();
    const writer = createIssueWriteService(database.db);
    const mediaIds = [randomUUID(), randomUUID()];
    await database.db.insert(issueMediaAssets).values(
      mediaIds.map((id, index) => ({
        id,
        uploadedByMemberId: session.member.id,
        sourceType: "MEMBER_SUBMISSION",
        rightsAttestation: "Current signup image processing consent applies to this image.",
        rightsAttestedAt: new Date(),
        sha256: id.replaceAll("-", "").repeat(2),
        perceptualHash: String(index + 1).repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 10,
        inputHeight: 10,
        outputByteSize: 80,
        outputWidth: 10,
        outputHeight: 10,
        stagingObjectKey: `issue-media/staging/${id}.webp`,
        stagedAt: new Date(),
      })),
    );
    const command = {
      ...createPayload("사진 중에서 어떤 분위기가 좋을까"),
      interestCardCode: "DAILY_LIFE" as const,
      sessionToken: session.token,
      idempotencyKey: randomUUID(),
      mediaAssetAId: mediaIds[0],
      mediaAssetBId: mediaIds[1],
    };
    const first = (await writer.submitMemberIssue(command)).submission;
    const cancelled = (await writer.submitMemberIssue({ ...command, idempotencyKey: randomUUID() }))
      .submission;
    await writer.actOnMemberIssueSubmission({
      sessionToken: session.token,
      submissionId: cancelled.id,
      expectedRevision: 1,
      action: "CANCEL",
    });
    await reconcileReviewedIssueSubmissions(database.db, mediaIds[0]!);
    expect(
      (
        await writer.listMemberIssueSubmissions({ sessionToken: session.token, limit: 20 })
      ).items.find((item) => item.id === first.id)?.publishedIssueId,
    ).toBeNull();
    for (const id of mediaIds) {
      await database.db
        .update(issueMediaAssets)
        .set({
          moderationState: "APPROVED",
          storageState: "PUBLISHED",
          stagingObjectKey: null,
          publishedObjectKey: `issue-media/published/${id}.webp`,
          publishedAt: new Date(),
        })
        .where(eq(issueMediaAssets.id, id));
      await reconcileReviewedIssueSubmissions(database.db, id);
      if (id === mediaIds[0])
        expect(
          (
            await writer.listMemberIssueSubmissions({ sessionToken: session.token, limit: 20 })
          ).items.find((item) => item.id === first.id)?.publishedIssueId,
        ).toBeNull();
    }
    await reconcileReviewedIssueSubmissions(database.db, mediaIds[1]!);
    const items = (
      await writer.listMemberIssueSubmissions({ sessionToken: session.token, limit: 20 })
    ).items;
    const published = items.find((item) => item.id === first.id)!;
    expect(published.publicationState).toBe("PUBLISHED");
    expect(items.find((item) => item.id === cancelled.id)?.publicationState).toBe("CANCELLED");
    const links = await database.db
      .select()
      .from(issueChoiceMedia)
      .where(eq(issueChoiceMedia.issueId, published.publishedIssueId!));
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.altText).sort()).toEqual(
      [command.choiceA, command.choiceB].sort(),
    );
    expect(
      await database.db
        .select()
        .from(issueAuthors)
        .where(eq(issueAuthors.memberId, session.member.id)),
    ).toHaveLength(1);
  });

  it("reuses one approved Library pair across multiple immediately published Issues", async () => {
    const session = await createSession("Library 질문 회원");
    const pairId = randomUUID();
    const mediaIds = [randomUUID(), randomUUID()];
    await database.db.insert(issueMediaAssets).values(
      mediaIds.map((id, index) => ({
        id,
        uploadedByMemberId: session.member.id,
        sourceType: "OPERATOR_UPLOAD",
        rightsAttestation: "Approved reusable Library image with recorded commercial rights.",
        rightsAttestedAt: new Date(),
        sha256: String(index + 4).repeat(64),
        perceptualHash: String(index + 4).repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 10,
        inputHeight: 10,
        outputByteSize: 80,
        outputWidth: 10,
        outputHeight: 10,
        processingState: "READY",
        moderationState: "APPROVED",
        storageState: "PUBLISHED",
        rightsState: "CLEARED",
        publishedObjectKey: "issue-media/published/" + id + ".webp",
        publishedAt: new Date(),
      })),
    );
    await database.db.insert(issueMediaLibraryPairs).values({
      id: pairId,
      title: "도시와 자연",
      categoryCode: "LIFE",
      topics: ["생활", "환경"],
      createdByMemberId: session.member.id,
    });
    await database.db.insert(issueMediaLibraryAssets).values(
      mediaIds.map((mediaAssetId, index) => ({
        pairId,
        side: index === 0 ? "A" : "B",
        mediaAssetId,
        altText: index === 0 ? "도시의 거리" : "숲속 산책로",
        sourceUrl: "https://source.example/" + String(index),
        authorName: "Library Author",
        licenseName: "Commercial reusable license",
        licenseVersion: "2026-08",
        acquiredAt: new Date(),
        commercialAllowed: true,
        derivativeAllowed: true,
        redistributionAllowed: true,
        evidenceReference: "https://evidence.example/" + String(index),
      })),
    );

    const issueIds: string[] = [];
    for (const question of ["주말에는 어디에서 쉬는 게 좋을까", "휴가지는 어디가 더 끌릴까"]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/issues",
        headers: { authorization: "Bearer " + session.token, "idempotency-key": randomUUID() },
        payload: { ...createPayload(question), libraryPairId: pairId },
      });
      expect(response.statusCode).toBe(201);
      issueIds.push(response.json<{ issue: { id: string } }>().issue.id);
    }

    const [links, usages, versions] = await Promise.all([
      database.db.select().from(issueChoiceMedia),
      database.db.select().from(issueMediaLibraryUsages),
      database.db.select().from(issueVersions),
    ]);
    expect(links.filter((link) => issueIds.includes(link.issueId))).toHaveLength(4);
    expect(
      links
        .filter((link) => issueIds.includes(link.issueId))
        .map((link) => link.mediaAssetId)
        .sort(),
    ).toEqual([...mediaIds, ...mediaIds].sort());
    expect(usages.filter((usage) => issueIds.includes(usage.issueId))).toHaveLength(4);
    expect(
      versions
        .filter((version) => issueIds.includes(version.issueId))
        .map((item) => item.mediaMode),
    ).toEqual(["OPTION_IMAGES", "OPTION_IMAGES"]);
    const writer = createIssueWriteService(database.db);
    const pending = (
      await writer.submitMemberIssue({
        ...createPayload("다음 휴일에는 어디가 좋을까"),
        interestCardCode: "DAILY_LIFE",
        sessionToken: session.token,
        idempotencyKey: randomUUID(),
      })
    ).submission;
    const converted = await writer.actOnMemberIssueSubmission({
      sessionToken: session.token,
      submissionId: pending.id,
      expectedRevision: 1,
      action: "LIBRARY",
      libraryPairId: pairId,
    });
    expect(converted.submission.publicationState).toBe("PUBLISHED");
    expect(
      await database.db
        .select()
        .from(issueChoiceMedia)
        .where(eq(issueChoiceMedia.issueId, converted.submission.publishedIssueId!)),
    ).toHaveLength(2);
    const history = (
      await writer.listMemberIssueSubmissions({ sessionToken: session.token, limit: 20 })
    ).items;
    expect(history).toHaveLength(3);
    expect(history.every((item) => item.publicationState === "PUBLISHED")).toBe(true);
  });

  it("accepts only paired staged media owned by the submitting Member", async () => {
    const session = await createSession("이미지 질문 회원");
    const mediaIds = [randomUUID(), randomUUID()];
    await database.db.insert(issueMediaAssets).values(
      mediaIds.map((id, index) => ({
        id,
        uploadedByMemberId: session.member.id,
        sourceType: "MEMBER_SUBMISSION",
        rightsAttestation: "I own this image and allow editorial review and publication.",
        rightsAttestedAt: new Date(),
        sha256: String(index + 1).repeat(64),
        perceptualHash: String(index + 1).repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 10,
        inputHeight: 10,
        outputByteSize: 80,
        outputWidth: 10,
        outputHeight: 10,
        stagingObjectKey: `issue-media/staging/${id}.webp`,
        stagedAt: new Date(),
      })),
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/member/issue-submissions",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: {
        ...createPayload("이미지와 함께 무엇을 고를까"),
        mediaAssetAId: mediaIds[0],
        mediaAssetBId: mediaIds[1],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      submission: { mediaAssetAId: mediaIds[0], mediaAssetBId: mediaIds[1] },
    });

    const oneSided = await app.inject({
      method: "POST",
      url: "/v1/member/issue-submissions",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: { ...createPayload("이미지 한 장만 제출하면 될까"), mediaAssetAId: mediaIds[0] },
    });
    expect(oneSided.statusCode).toBe(422);
    expect(oneSided.json()).toMatchObject({ code: "ISSUE_SUBMISSION_MEDIA_INVALID" });
  });

  it("attaches the first A/B media pair to an unchanged pending submission", async () => {
    const session = await createSession("Pilot 이미지 회원");
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/member/issue-submissions",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: createPayload("사진으로 비교하면 더 쉬울까"),
    });
    expect(submitted.statusCode).toBe(201);
    const first = submitted.json<{ submission: MemberIssueSubmission }>().submission;
    const mediaIds = [randomUUID(), randomUUID()];
    await database.db.insert(issueMediaAssets).values(
      mediaIds.map((id, index) => ({
        id,
        uploadedByMemberId: session.member.id,
        sourceType: "MEMBER_SUBMISSION",
        rightsAttestation: "Signup image policy consent applies to this private staged asset.",
        rightsAttestedAt: new Date(),
        sha256: String(index + 6).repeat(64),
        perceptualHash: String(index + 6).repeat(16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 10,
        inputHeight: 10,
        outputByteSize: 80,
        outputWidth: 10,
        outputHeight: 10,
        stagingObjectKey: `issue-media/staging/${id}.webp`,
        stagedAt: new Date(),
      })),
    );
    const augmented = await app.inject({
      method: "PUT",
      url: `/v1/member/issue-submissions/${first.id}`,
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: {
        ...createPayload("사진으로 비교하면 더 쉬울까"),
        expectedRevision: first.revision,
        mediaAssetAId: mediaIds[0],
        mediaAssetBId: mediaIds[1],
      },
    });
    expect(augmented.statusCode).toBe(200);
    expect(augmented.json()).toMatchObject({
      submission: {
        id: first.id,
        revision: 2,
        status: "PENDING",
        mediaAssetAId: mediaIds[0],
        mediaAssetBId: mediaIds[1],
      },
    });

    const hiddenEdit = await app.inject({
      method: "PUT",
      url: `/v1/member/issue-submissions/${first.id}`,
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: {
        ...createPayload("내용까지 몰래 바꾸면 안 될까"),
        expectedRevision: 2,
        mediaAssetAId: mediaIds[0],
        mediaAssetBId: mediaIds[1],
      },
    });
    expect(hiddenEdit.statusCode).toBe(200);
    expect(hiddenEdit.json()).toMatchObject({ submission: { revision: 3, status: "PENDING" } });
  });

  it("preserves revisions when a requested change is resubmitted", async () => {
    const session = await createSession("수정본 제출 회원");
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/member/issue-submissions",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: createPayload("아침에는 무엇을 먼저 할까"),
    });
    expect(submitted.statusCode).toBe(201);
    const first = submitted.json<{ submission: { id: string; revision: number } }>().submission;

    await database.db
      .update(memberIssueSubmissions)
      .set({ status: "NEEDS_CHANGES", reviewNote: "선택지를 더 구체적으로 작성해 주세요." })
      .where(eq(memberIssueSubmissions.id, first.id));

    const idempotencyKey = randomUUID();
    const request = {
      method: "PUT" as const,
      url: `/v1/member/issue-submissions/${first.id}`,
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": idempotencyKey },
      payload: {
        ...createPayload("아침에는 무엇을 먼저 할까"),
        choiceA: "물 한 잔 마시기",
        choiceB: "스트레칭부터 하기",
        expectedRevision: 1,
      },
    };
    const revised = await app.inject(request);
    expect(revised.statusCode).toBe(200);
    expect(revised.json()).toMatchObject({
      created: true,
      submission: { id: first.id, revision: 2, status: "PENDING", reviewNote: null },
    });

    const replayed = await app.inject(request);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({
      created: false,
      submission: { id: first.id, revision: 2 },
    });

    const revisions = await database.db
      .select()
      .from(memberIssueSubmissionRevisions)
      .where(eq(memberIssueSubmissionRevisions.submissionId, first.id));
    expect(revisions).toHaveLength(2);
    expect(revisions.map((revision) => revision.revision).sort()).toEqual([1, 2]);
  });

  it("requires a Member session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: { "idempotency-key": randomUUID() },
      payload: createPayload("퇴근 후 바로 잘까"),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "SESSION_REQUIRED" });
  });

  it("publishes all dependent state atomically and replays idempotently", async () => {
    const session = await createSession();
    const idempotencyKey = randomUUID();
    const request = {
      method: "POST" as const,
      url: "/v1/issues",
      headers: {
        authorization: `Bearer ${session.token}`,
        "idempotency-key": idempotencyKey,
      },
      payload: createPayload("퇴근 후 바로 잘까"),
    };

    const created = await app.inject(request);
    expect(created.statusCode).toBe(201);
    const body = created.json<{ issue: { id: string; question: string }; created: boolean }>();
    expect(body.created).toBe(true);
    expect(body.issue.question).toBe("퇴근 후 바로 잘까?");

    const replayed = await app.inject(request);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ created: false, issue: { id: body.issue.id } });

    const [versions, choices, cards, authors, aggregates, snapshots, events] = await Promise.all([
      database.db.select().from(issueVersions).where(eq(issueVersions.issueId, body.issue.id)),
      database.db.select().from(issueChoices).where(eq(issueChoices.issueId, body.issue.id)),
      database.db
        .select()
        .from(issueInterestCards)
        .where(eq(issueInterestCards.issueId, body.issue.id)),
      database.db.select().from(issueAuthors).where(eq(issueAuthors.issueId, body.issue.id)),
      database.db.select().from(voteAggregates).where(eq(voteAggregates.issueId, body.issue.id)),
      database.db.select().from(resultSnapshots).where(eq(resultSnapshots.issueId, body.issue.id)),
      database.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, `${body.issue.id}:1`)),
    ]);
    expect(versions).toHaveLength(1);
    expect(choices.map((choice) => choice.code).sort()).toEqual(["A", "B"]);
    expect(cards).toMatchObject([{ cardCode: "DAILY_LIFE", taxonomyVersion: "interest_cards_v1" }]);
    expect(authors).toMatchObject([{ memberId: session.member.id }]);
    expect(aggregates).toMatchObject([{ acceptedVoteCount: 0, displayedVoteCount: 0 }]);
    expect(snapshots).toMatchObject([{ resultVersion: 1, displayedVoteCount: 0 }]);
    expect(events).toMatchObject([{ eventType: "ISSUE_PUBLISHED" }]);
  });

  it("rejects unsafe or ambiguous content", async () => {
    const session = await createSession("안전 검증 회원");
    const unsafe = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: { ...createPayload("대통령 선거 후보는 누구"), choiceA: "1번", choiceB: "2번" },
    });
    expect(unsafe.statusCode).toBe(422);
    expect(unsafe.json()).toMatchObject({ code: "UNSAFE_ISSUE_CONTENT" });

    const duplicateChoices = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: { ...createPayload("오늘 무엇을 먹을까"), choiceA: "라면", choiceB: "라면" },
    });
    expect(duplicateChoices.statusCode).toBe(422);
    expect(duplicateChoices.json()).toMatchObject({ code: "INVALID_ISSUE_CONTENT" });
  });

  it("limits each Member to three questions per rolling day", async () => {
    const session = await createSession("많이 묻는 회원");
    for (let index = 1; index <= 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/issues",
        headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
        payload: createPayload(`오늘의 선택 ${index}번은 무엇일까`),
      });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/issues",
      headers: { authorization: `Bearer ${session.token}`, "idempotency-key": randomUUID() },
      payload: createPayload("네 번째 선택은 무엇일까"),
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "ISSUE_CREATION_LIMIT_REACHED" });
  });
});
