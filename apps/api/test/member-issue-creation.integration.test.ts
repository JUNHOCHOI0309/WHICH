import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  issueAuthors,
  issueChoices,
  issueInterestCards,
  issueVersions,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createIssueWriteService } from "../src/modules/issues/creation-service.js";
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
