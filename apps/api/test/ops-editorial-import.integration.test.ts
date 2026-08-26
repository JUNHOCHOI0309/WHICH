import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  operatorEditorialDecisions,
} from "../src/database/schema/index.js";
import {
  applyEditorialDecisionImport,
  planEditorialDecisionImport,
  type EditorialDecisionImportBundle,
} from "../src/modules/operations/editorial-import.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;
let operatorMemberId: string;

const bundle: EditorialDecisionImportBundle = {
  digest: "a".repeat(64),
  store: {
    schemaVersion: 1,
    catalogId: "which-expanded-500-catalog-v2",
    updatedAt: "2026-08-24T20:17:59.115Z",
    decisions: [
      {
        candidateId: "WEXP-0001",
        status: "APPROVED",
        note: "",
        reviewedBy: "WHICH_PRODUCT_OWNER",
        reviewedAt: "2026-08-24T20:08:52.859Z",
        checks: {
          binaryFit: true,
          choiceParity: true,
          duplicateReview: true,
          sourceReview: true,
        },
      },
      {
        candidateId: "WEXP-0016",
        status: "NEEDS_CHANGES",
        note: "선택지 표현 보완",
        reviewedBy: "WHICH_PRODUCT_OWNER",
        reviewedAt: "2026-08-24T20:12:08.208Z",
        checks: {
          binaryFit: false,
          choiceParity: false,
          duplicateReview: false,
          sourceReview: false,
        },
      },
    ],
  },
};

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
  const inserted = await database.db
    .insert(members)
    .values({ displayName: "Editorial importer" })
    .returning({ id: members.id });
  operatorMemberId = inserted[0]!.id;
  await database.db.insert(operatorAccessGrants).values({
    memberId: operatorMemberId,
    grantedBy: "integration-test",
  });
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
}, 30_000);

describe("Editorial decision import", () => {
  it("plans, applies, and then treats the same decision file as a no-op", async () => {
    const dryRun = await planEditorialDecisionImport(database.db, bundle, "production");
    expect(dryRun.summary).toEqual({ total: 2, create: 2, noOp: 0, conflict: 0 });

    await expect(
      applyEditorialDecisionImport({
        database: database.db,
        bundle,
        targetEnvironment: "production",
        confirmation: "wrong-token",
        operatorMemberId,
        actor: "integration-test",
      }),
    ).rejects.toThrow("Confirmation mismatch");

    const applied = await applyEditorialDecisionImport({
      database: database.db,
      bundle,
      targetEnvironment: "production",
      confirmation: dryRun.confirmation,
      operatorMemberId,
      actor: "integration-test",
    });
    expect(applied.summary).toEqual({ total: 2, create: 2, noOp: 0, conflict: 0 });

    const repeated = await planEditorialDecisionImport(database.db, bundle, "production");
    expect(repeated.summary).toEqual({ total: 2, create: 0, noOp: 2, conflict: 0 });
    const rows = await database.db.select().from(operatorEditorialDecisions);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.reviewedByMemberId)).toEqual([operatorMemberId, operatorMemberId]);
    const auditRows = await database.db
      .select({ eventType: operatorAuditLogs.eventType, outcome: operatorAuditLogs.outcome })
      .from(operatorAuditLogs)
      .where(eq(operatorAuditLogs.memberId, operatorMemberId));
    expect(auditRows).toContainEqual({
      eventType: "OPS_EDITORIAL_DECISIONS_IMPORTED",
      outcome: "SUCCEEDED",
    });
  });

  it("reports and refuses a conflicting production decision", async () => {
    const conflictBundle: EditorialDecisionImportBundle = {
      ...bundle,
      digest: "b".repeat(64),
      store: {
        ...bundle.store,
        decisions: bundle.store.decisions.map((decision) =>
          decision.candidateId === "WEXP-0016"
            ? { ...decision, status: "REJECTED" as const }
            : decision,
        ),
      },
    };
    const plan = await planEditorialDecisionImport(database.db, conflictBundle, "production");
    expect(plan.summary).toEqual({ total: 2, create: 0, noOp: 1, conflict: 1 });
    expect(plan.conflictCandidateIds).toEqual(["WEXP-0016"]);

    await expect(
      applyEditorialDecisionImport({
        database: database.db,
        bundle: conflictBundle,
        targetEnvironment: "production",
        confirmation: plan.confirmation,
        operatorMemberId,
        actor: "integration-test",
      }),
    ).rejects.toThrow("conflicting decisions");
    expect(await database.db.select().from(operatorEditorialDecisions)).toHaveLength(2);
  });
});
