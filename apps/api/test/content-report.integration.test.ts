import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  contentReports,
  issueChoices,
  issueMediaAssets,
  issues,
  issueVersions,
  members,
  reportCases,
  reportClusters,
  reporterSignalSnapshots,
  reportSignalSnapshots,
} from "../src/database/schema/index.js";
import { createCommentService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createContentReportService } from "../src/modules/reports/service.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "content-report-test-internal-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;

async function createIssue() {
  const issueId = randomUUID();
  await database.db.insert(issues).values({ id: issueId });
  await database.db.insert(issueVersions).values({
    issueId,
    version: 1,
    question: "How should report clustering work?",
    contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    primaryCategoryCode: "TEST",
    experienceModeCode: "BINARY",
    taxonomyVersion: "v1",
    publishedAt: new Date(),
  });
  await database.db.insert(issueChoices).values([
    { issueId, issueVersion: 1, code: "A", label: "A" },
    { issueId, issueVersion: 1, code: "B", label: "B" },
  ]);
  return issueId;
}

async function createGuest() {
  const response = await app.inject({ method: "POST", url: "/v1/guest-subjects" });
  expect(response.statusCode).toBe(201);
  return response.json<{ anonymousSubjectId: string }>().anonymousSubjectId;
}

async function createSession(providerSubject: string, anonymousSubjectId?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject,
      displayName: "신고 테스트 회원",
      anonymousSubjectId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string; member: { id: string } }>();
}

function reportAsGuest(
  targetType: "ISSUE" | "ISSUE_MEDIA",
  targetId: string,
  anonymousSubjectId: string,
  reasonCode = "SPAM",
  idempotencyKey = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: {
      "x-anonymous-subject-id": anonymousSubjectId,
      "idempotency-key": idempotencyKey,
    },
    payload: { targetType, targetId, reasonCode },
  });
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const config = getConfig({
    NODE_ENV: "test",
    INTERNAL_AUTH_SECRET: INTERNAL_SECRET,
  });
  const identity = createMemberIdentityService(database.db, {
    sessionTtlSeconds: 3_600,
    allowDevelopmentProvider: true,
  });
  app = await buildApp(config, {
    ...database,
    issueReader: createIssueReadService(database.db),
    guestVotes: createGuestVoteService(database.db),
    commentReader: createCommentService(database.db),
    memberIdentity: identity,
    contentReports: createContentReportService(database.db),
  });
}, 30_000);

afterAll(async () => {
  await app.close();
  await dropDatabase();
});

describe("Issue and media report Signal v2", () => {
  it("keeps reports idempotent and stores independent shadow Signals without enforcing deletion", async () => {
    const issueId = await createIssue();
    const guest = await createGuest();
    const key = randomUUID();
    const first = await reportAsGuest("ISSUE", issueId, guest, "SPAM", key);
    const replay = await reportAsGuest("ISSUE", issueId, guest, "SPAM", key);

    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      case: { status: "OPEN", priority: "NORMAL", automationRecommendation: "NONE" },
      signals: {
        reporterCount: 1,
        weightedScore: 1,
        clusterClassification: "BASELINE",
        shadowOnly: true,
      },
    });
    expect((await reportAsGuest("ISSUE", issueId, guest)).statusCode).toBe(409);

    const [storedIssue] = await database.db
      .select({ lifecycle: issues.lifecycle, visibility: issues.visibility })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(storedIssue).toEqual({ lifecycle: "PUBLISHED", visibility: "VISIBLE" });
    expect(await database.db.select().from(reportSignalSnapshots)).toHaveLength(1);
    expect(await database.db.select().from(reporterSignalSnapshots)).toHaveLength(1);
  });

  it("flags concentrated new-Guest activity as a shadow Cluster, not a verdict", async () => {
    const issueId = await createIssue();
    let fifthResponse: Awaited<ReturnType<typeof reportAsGuest>> | undefined;
    for (let index = 0; index < 5; index += 1) {
      fifthResponse = await reportAsGuest("ISSUE", issueId, await createGuest());
      expect(fifthResponse.statusCode).toBe(201);
    }

    expect(fifthResponse?.json()).toMatchObject({
      case: { status: "OPEN", automationRecommendation: "NONE" },
      signals: {
        reporterCount: 5,
        reports15m: 5,
        clusterClassification: "COORDINATED_SUSPECTED",
        shadowOnly: true,
      },
    });
    const [cluster] = await database.db
      .select({ classification: reportClusters.classification })
      .from(reportClusters)
      .innerJoin(reportCases, eq(reportCases.id, reportClusters.caseId))
      .where(eq(reportCases.targetId, issueId));
    expect(cluster?.classification).toBe("COORDINATED_SUSPECTED");
  });

  it("merges linked Guest and Member reports while preserving both original rows", async () => {
    const issueId = await createIssue();
    const firstGuest = await createGuest();
    const secondGuest = await createGuest();
    expect((await reportAsGuest("ISSUE", issueId, firstGuest)).statusCode).toBe(201);
    const member = await createSession(`content-report-link-${issueId}`, secondGuest);
    const memberReport = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${member.token}`, "idempotency-key": randomUUID() },
      payload: { targetType: "ISSUE", targetId: issueId, reasonCode: "HATE" },
    });
    expect(memberReport.statusCode).toBe(201);

    await createSession(`content-report-link-${issueId}`, firstGuest);
    const rows = await database.db
      .select({ counted: contentReports.counted, mergedInto: contentReports.mergedIntoReportId })
      .from(contentReports)
      .where(eq(contentReports.targetId, issueId))
      .orderBy(asc(contentReports.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.counted)).toHaveLength(1);
    expect(rows.filter((row) => !row.counted && row.mergedInto !== null)).toHaveLength(1);
  });

  it("records published Asset reports and keeps rights-like claims on a reversible review path", async () => {
    const issueId = await createIssue();
    const member = await createSession(`asset-owner-${issueId}`);
    const [memberRow] = await database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, member.member.id));
    expect(memberRow).toBeDefined();
    const [asset] = await database.db
      .insert(issueMediaAssets)
      .values({
        uploadedByMemberId: member.member.id,
        sourceType: "MEMBER_SUBMISSION",
        rightsAttestation: "I own this test asset and allow publication for report testing.",
        rightsAttestedAt: new Date(),
        sha256: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        perceptualHash: randomUUID().replaceAll("-", "").slice(0, 16),
        inputMimeType: "image/png",
        inputByteSize: 100,
        inputWidth: 100,
        inputHeight: 100,
        outputByteSize: 80,
        outputWidth: 100,
        outputHeight: 100,
        processingState: "READY",
        moderationState: "APPROVED",
        storageState: "PUBLISHED",
        rightsState: "ASSERTED",
        publishedObjectKey: `published/${randomUUID()}.webp`,
      })
      .returning({ id: issueMediaAssets.id });
    expect(asset).toBeDefined();

    const response = await reportAsGuest(
      "ISSUE_MEDIA",
      asset!.id,
      await createGuest(),
      "IMPERSONATION",
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      case: { status: "OPEN", priority: "NORMAL", automationRecommendation: "NONE" },
    });
    const [storedAsset] = await database.db
      .select({ storageState: issueMediaAssets.storageState })
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, asset!.id));
    expect(storedAsset?.storageState).toBe("PUBLISHED");
  });

  it("routes critical reports to P0 review without permanent action", async () => {
    const issueId = await createIssue();
    const member = await createSession(`critical-reporter-${issueId}`);
    const response = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${member.token}`, "idempotency-key": randomUUID() },
      payload: {
        targetType: "ISSUE",
        targetId: issueId,
        reasonCode: "PRIVACY",
        detail: "The Issue appears to expose personally identifying contact information.",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      case: { status: "PENDING_REVIEW", priority: "P0", automationRecommendation: "P0_REVIEW" },
    });
    const [storedIssue] = await database.db
      .select({ visibility: issues.visibility })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(storedIssue?.visibility).toBe("VISIBLE");
  });
});
