import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createInterestProfileService } from "../src/modules/interests/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "interest-profile-test-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createGuest() {
  const response = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  expect(response.statusCode).toBe(201);
  return response.json<{ anonymousSubjectId: string }>().anonymousSubjectId;
}

async function createMemberSession(anonymousSubjectId?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject: randomUUID(),
      displayName: "관심사 테스트 회원",
      anonymousSubjectId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string }>().token;
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
    interestProfiles: createInterestProfileService(database.db),
  });
}, 30_000);

afterAll(async () => {
  await app.close();
  await dropDatabase();
});

describe("Interest Profile foundation", () => {
  it("publishes 14 non-political Interest Cards with a stable version", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/interests/cards" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      taxonomyVersion: string;
      minSelections: number;
      maxSelections: number;
      cards: Array<{ code: string; label: string }>;
    }>();
    expect(body).toMatchObject({
      taxonomyVersion: "interest_cards_v1",
      minSelections: 3,
      maxSelections: 8,
    });
    expect(body.cards).toHaveLength(14);
    expect(body.cards.map((card) => card.code)).not.toContain("POLITICS");
  });

  it("lets a Guest complete, restore, and reset only the Interest Profile", async () => {
    const anonymousSubjectId = await createGuest();
    const headers = { "x-anonymous-subject-id": anonymousSubjectId };

    const initial = await app.inject({ method: "GET", url: "/v1/interest-profile", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      onboardingState: "NOT_STARTED",
      selectedCardCodes: [],
      canSkip: true,
    });

    const tooShort = await app.inject({
      method: "PUT",
      url: "/v1/interest-profile",
      headers,
      payload: { onboardingState: "COMPLETED", selectedCardCodes: ["FOOD", "TECH"] },
    });
    expect(tooShort.statusCode).toBe(422);
    expect(tooShort.json()).toMatchObject({ code: "INVALID_INTEREST_SELECTION" });

    const completed = await app.inject({
      method: "PUT",
      url: "/v1/interest-profile",
      headers,
      payload: {
        onboardingState: "COMPLETED",
        selectedCardCodes: ["FOOD", "TECH", "GAME"],
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
    });

    const restored = await app.inject({ method: "GET", url: "/v1/interest-profile", headers });
    expect(restored.json()).toMatchObject({
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
    });

    const reset = await app.inject({
      method: "POST",
      url: "/v1/interest-profile/reset",
      headers,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ onboardingState: "RESET", selectedCardCodes: [] });
  });

  it("allows a Guest to skip without blocking the Core Vote identity", async () => {
    const anonymousSubjectId = await createGuest();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/interest-profile",
      headers: { "x-anonymous-subject-id": anonymousSubjectId },
      payload: { onboardingState: "SKIPPED", selectedCardCodes: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ onboardingState: "SKIPPED", canSkip: true });
  });

  it("shows a linked Guest merge candidate and merges only confirmed cards", async () => {
    const anonymousSubjectId = await createGuest();
    await app.inject({
      method: "PUT",
      url: "/v1/interest-profile",
      headers: { "x-anonymous-subject-id": anonymousSubjectId },
      payload: {
        onboardingState: "COMPLETED",
        selectedCardCodes: ["FOOD", "GAME", "TECH"],
      },
    });
    const token = await createMemberSession(anonymousSubjectId);
    const memberHeaders = {
      authorization: `Bearer ${token}`,
      "x-anonymous-subject-id": anonymousSubjectId,
    };

    const candidate = await app.inject({
      method: "GET",
      url: "/v1/interest-profile",
      headers: memberHeaders,
    });
    expect(candidate.statusCode).toBe(200);
    expect(candidate.json()).toMatchObject({
      selectedCardCodes: [],
      mergeCandidate: {
        anonymousSubjectId,
        guestCardCodes: ["FOOD", "GAME", "TECH"],
        suggestedCardCodes: ["FOOD", "GAME", "TECH"],
      },
    });

    const merged = await app.inject({
      method: "POST",
      url: "/v1/interest-profile/merge",
      headers: memberHeaders,
      payload: {
        anonymousSubjectId,
        selectedCardCodes: ["FOOD", "GAME", "TECH"],
      },
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({
      onboardingState: "COMPLETED",
      selectedCardCodes: ["FOOD", "GAME", "TECH"],
      mergeCandidate: null,
    });
  });
});
