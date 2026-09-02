import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import {
  issueAuthors,
  issueChoices,
  issues,
  issueVersions,
  operatorAccessGrants,
  operatorAuditLogs,
  operatorEditorialDecisions,
  pointCatalogItems,
  pointCatalogItemVersions,
} from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createOpsDashboardService } from "../src/modules/operations/service.js";
import type { OpsDashboardService } from "../src/modules/operations/contracts.js";
import { createPointIntegrityService } from "../src/modules/points/integrity.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "ops-dashboard-internal-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;
let token: string;
let memberId: string;
let ordinaryToken: string;
let opsDashboard: OpsDashboardService;

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const memberIdentity = createMemberIdentityService(database.db, {
    sessionTtlSeconds: 3600,
    allowDevelopmentProvider: true,
    requireVerifiedEmail: false,
    authSecurity: {
      verificationTtlSeconds: 3600,
      passwordResetTtlSeconds: 1800,
      rateLimitWindowSeconds: 900,
      signupLimit: 5,
      loginLimit: 10,
      emailDeliveryLimit: 3,
      tokenConsumeLimit: 10,
    },
  });
  opsDashboard = createOpsDashboardService(database.db, { releaseId: "ops-test-release" });
  app = await buildApp(getConfig({ NODE_ENV: "test", INTERNAL_AUTH_SECRET: INTERNAL_SECRET }), {
    ...database,
    issueReader: createIssueReadService(database.db),
    guestVotes: createGuestVoteService(database.db),
    commentReader: createCommentReadService(database.db),
    memberIdentity,
    opsDashboard,
    pointIntegrity: createPointIntegrityService(database.db, { targetEnvironment: "test" }),
  });
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject: "ops-dashboard-owner",
      displayName: "운영자",
    },
  });
  const session = sessionResponse.json<{ token: string; member: { id: string } }>();
  token = session.token;
  memberId = session.member.id;
  const ordinaryResponse = await app.inject({
    method: "POST",
    url: "/v1/internal/member-sessions",
    headers: { "x-internal-auth-secret": INTERNAL_SECRET },
    payload: {
      provider: "DEVELOPMENT",
      providerSubject: "ops-dashboard-ordinary",
      displayName: "일반 회원",
    },
  });
  ordinaryToken = ordinaryResponse.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  await app.close();
  await dropDatabase();
}, 30_000);

function readDashboard(days = 7) {
  return app.inject({
    method: "GET",
    url: `/v1/internal/ops/dashboard?days=${days}`,
    headers: {
      authorization: `Bearer ${token}`,
      "x-internal-auth-secret": INTERNAL_SECRET,
    },
  });
}

function opsRequest(
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
  sessionToken = token,
) {
  return app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "x-internal-auth-secret": INTERNAL_SECRET,
    },
    payload,
  });
}

describe("operator dashboard", () => {
  it("records verified support email metadata once behind the internal boundary", async () => {
    const payload = {
      eventId: "msg_support_webhook_001",
      emailId: "email_support_001",
      messageId: "<support-001@example.com>",
      sender: "sender@example.com",
      recipient: "support@which.site",
      subject: "서비스 문의",
      receivedAt: "2026-08-29T08:00:00.000Z",
      attachmentCount: 1,
    };
    const denied = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/support-email-events",
      payload,
    });
    expect(denied.statusCode).toBe(401);

    const first = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/support-email-events",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/internal/ops/support-email-events",
      headers: { "x-internal-auth-secret": INTERNAL_SECRET },
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ status: "RECORDED" });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual({ status: "REPLAYED" });

    const logs = await database.db
      .select({ metadata: operatorAuditLogs.metadata })
      .from(operatorAuditLogs)
      .where(eq(operatorAuditLogs.requestId, payload.eventId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({
      emailId: payload.emailId,
      recipient: payload.recipient,
      attachmentCount: 1,
      contentStored: false,
    });
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain("email body");
  });

  it("denies an ordinary Member and audits the decision", async () => {
    const response = await readDashboard();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "OPERATOR_ROLE_REQUIRED" });

    const logs = await database.db
      .select({ outcome: operatorAuditLogs.outcome })
      .from(operatorAuditLogs)
      .where(eq(operatorAuditLogs.memberId, memberId));
    expect(logs).toContainEqual({ outcome: "DENIED" });
  });

  it("returns a bounded aggregate snapshot to an active OPERATOR", async () => {
    await database.db.insert(operatorAccessGrants).values({
      memberId,
      grantedBy: "integration-test",
    });
    const response = await readDashboard(1);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      schemaVersion: 1,
      windowDays: 1,
      role: "OPERATOR",
      system: { releaseId: "ops-test-release", apiReadiness: "READY" },
      funnel: { reconciliation: { status: "CONSISTENT" } },
    });
    const serialized = JSON.stringify(body).toLocaleLowerCase("en-US");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("oauth");

    const logs = await database.db
      .select({ outcome: operatorAuditLogs.outcome })
      .from(operatorAuditLogs)
      .where(eq(operatorAuditLogs.memberId, memberId));
    expect(logs).toContainEqual({ outcome: "ALLOWED" });
  });

  it("exposes an operator-only explainable ranking preview", async () => {
    const [allowed, denied] = await Promise.all([
      opsRequest("GET", "/v1/internal/ops/ranking-preview?limit=10"),
      opsRequest("GET", "/v1/internal/ops/ranking-preview?limit=10", undefined, ordinaryToken),
    ]);
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json()).toMatchObject({
      schemaVersion: 1,
      configuredMode: "OFF",
      policyVersion: "quality-feed-v1.0",
      items: [],
    });
    expect(denied.statusCode).toBe(403);
  });

  it("rejects windows outside 1, 7, and 30 days", async () => {
    const response = await readDashboard(90);
    expect(response.statusCode).toBe(400);
  });

  it("keeps Member and Editorial management routes behind the OPERATOR role", async () => {
    const [membersResponse, editorialResponse] = await Promise.all([
      opsRequest("GET", "/v1/internal/ops/members", undefined, ordinaryToken),
      opsRequest("GET", "/v1/internal/ops/editorial", undefined, ordinaryToken),
    ]);
    expect(membersResponse.statusCode).toBe(403);
    expect(editorialResponse.statusCode).toBe(403);
  });

  it("requires both the internal Access boundary and WHICH OPERATOR for Point Ops", async () => {
    const ordinary = await opsRequest(
      "GET",
      "/v1/internal/ops/points/reconciliation",
      undefined,
      ordinaryToken,
    );
    expect(ordinary.statusCode).toBe(403);
    expect(ordinary.json()).toMatchObject({ code: "OPERATOR_ROLE_REQUIRED" });

    const missingBoundary = await app.inject({
      method: "GET",
      url: "/v1/internal/ops/points/reconciliation",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingBoundary.statusCode).toBe(401);
    expect(missingBoundary.body).not.toContain(INTERNAL_SECRET);
  });

  it("returns a PII-safe Member directory page", async () => {
    const response = await opsRequest(
      "GET",
      "/v1/internal/ops/members?limit=10&q=%EC%9A%B4%EC%98%81%EC%9E%90",
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      items: [
        {
          memberId,
          displayName: "운영자",
          status: "ACTIVE",
          activity: { votes: 0, comments: 0, issues: 0 },
        },
      ],
    });
    const serialized = response.body.toLocaleLowerCase("en-US");
    for (const forbidden of [
      "email",
      "providersubject",
      "token",
      "session",
      "ipaddress",
      "useragent",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("lists report-based account restrictions behind the operator boundary", async () => {
    const [allowed, denied] = await Promise.all([
      opsRequest("GET", "/v1/internal/ops/reported-members?limit=10"),
      opsRequest("GET", "/v1/internal/ops/reported-members?limit=10", undefined, ordinaryToken),
    ]);
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json()).toMatchObject({ schemaVersion: 1, items: [] });
    expect(denied.statusCode).toBe(403);
  });

  it("lists and controls an already-published Issue with optimistic concurrency", async () => {
    const [issue] = await database.db.insert(issues).values({}).returning({ id: issues.id });
    await database.db.insert(issueVersions).values({
      issueId: issue!.id,
      version: 1,
      question: "운영 화면에서 관리할 게시 질문은?",
      context: "게시된 질문 관리 통합 테스트",
      contentHash: "a".repeat(64),
      primaryCategoryCode: "LIFE",
      experienceModeCode: "STANDARD",
      taxonomyVersion: "v1",
      publishedAt: new Date("2026-09-02T10:00:00.000Z"),
    });
    await database.db.insert(issueChoices).values([
      { issueId: issue!.id, issueVersion: 1, code: "A", label: "계속 공개" },
      { issueId: issue!.id, issueVersion: 1, code: "B", label: "노출 중지" },
    ]);
    await database.db.insert(issueAuthors).values({ issueId: issue!.id, memberId });

    const list = await opsRequest(
      "GET",
      "/v1/internal/ops/published-issues?q=%EC%9A%B4%EC%98%81&limit=10",
    );
    expect(list.statusCode, list.body).toBe(200);
    const published = list.json<{
      items: Array<{ issueId: string; state: string; updatedAt: string }>;
    }>().items[0]!;
    expect(published).toMatchObject({ issueId: issue!.id, state: "ACTIVE" });

    const hidden = await opsRequest("PATCH", `/v1/internal/ops/published-issues/${issue!.id}`, {
      action: "HIDE",
      expectedUpdatedAt: published.updatedAt,
      reason: "신고 내용 검토를 위해 노출을 잠시 중지합니다.",
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    const hiddenIssue = hidden.json<{ updatedAt: string }>();
    expect(hiddenIssue).toMatchObject({ state: "HIDDEN", visibility: "SUSPENDED" });

    const stale = await opsRequest("PATCH", `/v1/internal/ops/published-issues/${issue!.id}`, {
      action: "RESTORE",
      expectedUpdatedAt: published.updatedAt,
      reason: "오래된 화면에서 복구를 시도하는 충돌 검증입니다.",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "PUBLISHED_ISSUE_CONFLICT" });

    const restored = await opsRequest("PATCH", `/v1/internal/ops/published-issues/${issue!.id}`, {
      action: "RESTORE",
      expectedUpdatedAt: hiddenIssue.updatedAt,
      reason: "신고 검토 결과 문제가 없어 질문을 다시 공개합니다.",
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredIssue = restored.json<{ updatedAt: string }>();
    expect(restoredIssue).toMatchObject({ state: "ACTIVE", visibility: "VISIBLE" });

    const removed = await opsRequest("PATCH", `/v1/internal/ops/published-issues/${issue!.id}`, {
      action: "REMOVE",
      expectedUpdatedAt: restoredIssue.updatedAt,
      reason: "운영 정책 위반이 확인되어 게시를 최종 중단합니다.",
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({
      state: "REMOVED",
      lifecycle: "RETIRED",
      visibility: "REMOVED",
    });
  });

  it("creates, pauses, reprices, and audits Point Shop catalog items", async () => {
    const denied = await opsRequest("GET", "/v1/internal/ops/point-shop", undefined, ordinaryToken);
    expect(denied.statusCode).toBe(403);

    const createdResponse = await opsRequest("POST", "/v1/internal/ops/point-shop/items", {
      code: "OPS_TEST_SOFT_ORBIT_ACCENT",
      equipSlot: "PROFILE_ACCENT",
      themeFamily: "SOFT_ORBIT",
      name: "Ops Test Accent",
      description: "운영 콘솔 통합 테스트용 프로필 강조색입니다.",
      price: 800,
      status: "PAUSED",
      reason: "운영 상점 생성 감사 로그 검증",
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(200);
    const created = createdResponse.json<{
      id: string;
      code: string;
      price: number;
      status: string;
      opsRevision: number;
      updatedAt: string;
    }>();
    expect(created).toMatchObject({
      code: "OPS_TEST_SOFT_ORBIT_ACCENT",
      price: 800,
      status: "PAUSED",
    });

    const updatedResponse = await opsRequest(
      "PATCH",
      `/v1/internal/ops/point-shop/items/${created.id}`,
      {
        expectedRevision: created.opsRevision,
        price: 950,
        status: "ACTIVE",
        reason: "출시 가격 확정 및 판매 시작",
      },
    );
    expect(updatedResponse.statusCode, updatedResponse.body).toBe(200);
    expect(updatedResponse.json()).toMatchObject({
      price: 950,
      status: "ACTIVE",
      opsRevision: created.opsRevision + 1,
    });

    const staleResponse = await opsRequest(
      "PATCH",
      `/v1/internal/ops/point-shop/items/${created.id}`,
      {
        expectedRevision: created.opsRevision,
        price: 1000,
        status: "PAUSED",
        reason: "오래된 화면의 변경 충돌 검증",
      },
    );
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({ code: "POINT_SHOP_CONFLICT" });

    const viewResponse = await opsRequest("GET", "/v1/internal/ops/point-shop");
    expect(viewResponse.statusCode, viewResponse.body).toBe(200);
    const view = viewResponse.json<{
      items: Array<{ code: string; price: number; status: string }>;
      audit: Array<{ eventType: string; metadata: Record<string, unknown> }>;
    }>();
    expect(view.items).toContainEqual(
      expect.objectContaining({
        code: "OPS_TEST_SOFT_ORBIT_ACCENT",
        price: 950,
        status: "ACTIVE",
      }),
    );
    expect(view.audit.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining(["OPS_POINT_SHOP_ITEM_CREATED", "OPS_POINT_SHOP_ITEM_UPDATED"]),
    );

    const [catalogItem] = await database.db
      .select({ id: pointCatalogItems.id })
      .from(pointCatalogItems)
      .where(eq(pointCatalogItems.code, "OPS_TEST_SOFT_ORBIT_ACCENT"));
    expect(catalogItem).toBeDefined();
    const versions = await database.db
      .select({ version: pointCatalogItemVersions.version })
      .from(pointCatalogItemVersions)
      .where(eq(pointCatalogItemVersions.itemId, catalogItem!.id));
    expect(versions).toEqual([{ version: 1 }]);
  });

  it("persists Editorial decisions and rejects stale revisions", async () => {
    const listResponse = await opsRequest("GET", "/v1/internal/ops/editorial?limit=1");
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const candidate = listResponse.json<{
      items: Array<{ candidateId: string; decision: { revision: number } | null }>;
    }>().items[0]!;

    const invalidApproval = await opsRequest(
      "PUT",
      `/v1/internal/ops/editorial/${candidate.candidateId}/decision`,
      {
        expectedRevision: candidate.decision?.revision ?? 0,
        status: "APPROVED",
        note: "검수 미완료",
        checks: {
          binaryFit: false,
          choiceParity: false,
          duplicateReview: false,
          sourceReview: false,
        },
      },
    );
    expect(invalidApproval.statusCode).toBe(400);

    const savedResponse = await opsRequest(
      "PUT",
      `/v1/internal/ops/editorial/${candidate.candidateId}/decision`,
      {
        expectedRevision: 0,
        status: "NEEDS_CHANGES",
        note: "선택지 표현을 맞춰 주세요.",
        checks: { binaryFit: true, choiceParity: false, duplicateReview: true, sourceReview: true },
      },
    );
    expect(savedResponse.statusCode, savedResponse.body).toBe(200);
    expect(savedResponse.json()).toMatchObject({ status: "NEEDS_CHANGES", revision: 1 });

    const staleResponse = await opsRequest(
      "PUT",
      `/v1/internal/ops/editorial/${candidate.candidateId}/decision`,
      {
        expectedRevision: 0,
        status: "REJECTED",
        note: "stale",
        checks: { binaryFit: true, choiceParity: true, duplicateReview: true, sourceReview: true },
      },
    );
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({
      code: "REVISION_CONFLICT",
      current: { status: "NEEDS_CHANGES", revision: 1 },
    });

    const rows = await database.db.select().from(operatorEditorialDecisions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ candidateId: candidate.candidateId, revision: 1 });
  });
});
