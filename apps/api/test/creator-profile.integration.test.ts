import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  issueAuthors,
  issueChoices,
  issues,
  issueVersions,
  voteAggregates,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import type { PublicCreatorProfile } from "../src/modules/identity/contracts.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "creator-profile-test-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createSession(displayName: string) {
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

async function createAuthoredIssue(memberId: string) {
  const issueId = randomUUID();
  const publishedAt = new Date("2026-08-22T03:00:00.000Z");
  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "Creator가 만든 공개 질문",
    contentHash: "d".repeat(64),
    primaryCategoryCode: "TECH",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt,
  });
  await database.db.insert(issueChoices).values([
    { issueId, issueVersion: 1, code: "A", label: "A 선택" },
    { issueId, issueVersion: 1, code: "B", label: "B 선택" },
  ]);
  await database.db.insert(voteAggregates).values({
    issueId,
    issueVersion: 1,
    voteRequestCount: 9,
    acceptedACount: 5,
    acceptedBCount: 4,
    acceptedVoteCount: 9,
    displayedVoteCount: 9,
  });
  await database.db.insert(issueAuthors).values({ issueId, memberId });
  return issueId;
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const config = getConfig({ NODE_ENV: "test", INTERNAL_AUTH_SECRET: INTERNAL_SECRET });
  app = await buildApp(config, {
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

describe("Creator Profile v1", () => {
  it("keeps profile writes behind the current Member session", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { handle: "creator_one", bio: null, visibility: "PUBLIC" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects reserved and case-insensitive duplicate handles", async () => {
    const first = await createSession("첫 번째 작성자");
    const second = await createSession("두 번째 작성자");

    const reserved = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${first.token}` },
      payload: { handle: "which", bio: null, visibility: "PRIVATE" },
    });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json()).toMatchObject({ code: "HANDLE_RESERVED" });

    const created = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${first.token}` },
      payload: { handle: "Creator_One", bio: "좋은 질문을 만듭니다.", visibility: "PUBLIC" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ handle: "creator_one", visibility: "PUBLIC" });

    const duplicate = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${second.token}` },
      payload: { handle: "CREATOR_ONE", bio: null, visibility: "PUBLIC" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "HANDLE_TAKEN" });
  });

  it("updates the private nickname together with Creator profile settings", async () => {
    const session = await createSession("기존 닉네임");
    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        displayName: "새 닉네임",
        handle: "renamed_creator",
        bio: "모바일에서 수정했어요.",
        visibility: "PRIVATE",
      },
    });
    const profile = await app.inject({
      method: "GET",
      url: "/v1/me?limit=1",
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      displayName: "새 닉네임",
      handle: "renamed_creator",
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ member: { displayName: "새 닉네임" } });
  });

  it("publishes only safe Creator fields and authored Issue aggregates", async () => {
    const session = await createSession("테크 질문가");
    const issueId = await createAuthoredIssue(session.member.id);
    await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        handle: "tech_creator",
        bio: "기술의 두 선택지를 묻습니다.",
        visibility: "PUBLIC",
      },
    });

    const response = await app.inject({ method: "GET", url: "/v1/profiles/TECH_CREATOR" });
    expect(response.statusCode).toBe(200);
    const body = response.json<PublicCreatorProfile>();
    expect(body.creator.joinedMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(body).toEqual({
      creator: {
        displayName: "테크 질문가",
        handle: "tech_creator",
        bio: "기술의 두 선택지를 묻습니다.",
        joinedMonth: body.creator.joinedMonth,
        avatar: { kind: "INITIALS", initials: "테질" },
      },
      stats: { publishedIssueCount: 1, acceptedVoteCount: 9 },
      issues: [
        {
          id: issueId,
          version: 1,
          question: "Creator가 만든 공개 질문",
          categoryCode: "TECH",
          publishedAt: "2026-08-22T03:00:00.000Z",
          acceptedVoteCount: 9,
        },
      ],
    });
    expect(body.creator).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("votes");

    const issue = await app.inject({ method: "GET", url: `/v1/issues/${issueId}` });
    expect(issue.statusCode).toBe(200);
    expect(issue.json()).toMatchObject({
      author: { displayName: "테크 질문가", handle: "tech_creator" },
    });
  });

  it("uses the same 404 boundary for private and missing profiles", async () => {
    const session = await createSession("비공개 작성자");
    await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: { authorization: `Bearer ${session.token}` },
      payload: { handle: "private_creator", bio: null, visibility: "PRIVATE" },
    });

    const hidden = await app.inject({ method: "GET", url: "/v1/profiles/private_creator" });
    const missing = await app.inject({ method: "GET", url: "/v1/profiles/missing_creator" });
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  });
});
