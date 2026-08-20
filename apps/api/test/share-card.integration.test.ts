import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  issueChoices,
  issues,
  issueVersions,
  resultSnapshots,
  shareCards,
} from "../src/database/schema/index.js";
import { registerShareCardRoutes } from "../src/modules/shares/routes.js";
import { createShareCardService } from "../src/modules/shares/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;
const issueId = randomUUID();

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "민트초코는 맛있다 vs 아니다",
    contentHash: "s".repeat(64),
    primaryCategoryCode: "FOOD",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt: new Date(),
  });
  await database.db.insert(issueChoices).values([
    { issueId, issueVersion: 1, code: "A", label: "맛있다" },
    { issueId, issueVersion: 1, code: "B", label: "아니다" },
  ]);
  await database.db.insert(resultSnapshots).values({
    issueId,
    issueVersion: 1,
    resultVersion: 7,
    acceptedACount: 12,
    acceptedBCount: 8,
    displayedVoteCount: 20,
    integrityState: "NORMAL",
  });
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("Result Share Card", () => {
  it("stores an immutable identity-free snapshot reference and only discloses choice by opt-in", async () => {
    const app = Fastify({ logger: false });
    await registerShareCardRoutes(
      app,
      createShareCardService(database.db, { enabled: true }),
      "share-test-secret",
    );
    const created = await app.inject({
      method: "POST",
      url: `/v1/internal/issues/${issueId}/share-cards`,
      headers: { "x-internal-auth-secret": "share-test-secret" },
      payload: { issueVersion: 1, resultVersion: 7, channel: "COPY" },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{ id: string }>();
    expect(createdBody).toMatchObject({
      version: "result_share_v1",
      shareType: "RESULT",
      sharedChoiceCode: null,
      result: { resultVersion: 7, acceptedA: 12, acceptedB: 8, displayedTotal: 20 },
    });
    expect(createdBody).not.toHaveProperty("subjectId");
    expect(createdBody).not.toHaveProperty("memberId");

    const stored = await database.db.select().from(shareCards);
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!)).not.toContain("subjectId");
    expect(Object.keys(stored[0]!)).not.toContain("memberId");

    const publicRead = await app.inject({
      method: "GET",
      url: `/v1/share-cards/${createdBody.id}`,
    });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json()).toEqual(createdBody);
    await app.close();
  });

  it("requires internal authentication and honors the feature flag", async () => {
    const disabled = Fastify({ logger: false });
    await registerShareCardRoutes(
      disabled,
      createShareCardService(database.db, { enabled: false }),
      "share-test-secret",
    );
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: `/v1/internal/issues/${issueId}/share-cards`,
          payload: { issueVersion: 1, resultVersion: 7, channel: "COPY" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: `/v1/internal/issues/${issueId}/share-cards`,
          headers: { "x-internal-auth-secret": "share-test-secret" },
          payload: { issueVersion: 1, resultVersion: 7, channel: "COPY" },
        })
      ).statusCode,
    ).toBe(404);
    await disabled.close();
  });
});
