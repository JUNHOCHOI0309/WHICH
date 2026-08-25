import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import type { Database } from "../src/database/client.js";
import { operatorAccessGrants, operatorAuditLogs } from "../src/database/schema/index.js";
import { createCommentReadService } from "../src/modules/comments/service.js";
import { createMemberIdentityService } from "../src/modules/identity/service.js";
import { createIssueReadService } from "../src/modules/issues/service.js";
import { createOpsDashboardService } from "../src/modules/operations/service.js";
import type { OpsDashboardService } from "../src/modules/operations/contracts.js";
import { createGuestVoteService } from "../src/modules/voting/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

const INTERNAL_SECRET = "ops-dashboard-internal-secret";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dropDatabase: () => Promise<void>;
let token: string;
let memberId: string;
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

describe("operator dashboard", () => {
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

  it("rejects windows outside 1, 7, and 30 days", async () => {
    const response = await readDashboard(90);
    expect(response.statusCode).toBe(400);
  });
});
