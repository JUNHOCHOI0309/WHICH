import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  operatorAccessGrants,
  operatorAuditLogs,
  operatorEditorialDecisions,
} from "../../database/schema/index.js";
import { expandedEditorialCatalogSchema } from "../issue-publication/editorial-catalog.js";
import {
  decisionStoreSchema,
  type DecisionStore,
  type StoredDecision,
} from "../issue-publication/review-console.js";

type ExistingDecision = {
  candidateId: string;
  status: string;
  note: string;
  binaryFit: boolean;
  choiceParity: boolean;
  duplicateReview: boolean;
  sourceReview: boolean;
  reviewedAt: Date;
};

export type EditorialDecisionImportBundle = {
  store: DecisionStore;
  digest: string;
};

export type EditorialDecisionImportPlan = {
  schemaVersion: 1;
  catalogId: string;
  digest: string;
  targetEnvironment: string;
  confirmation: string;
  summary: {
    total: number;
    create: number;
    noOp: number;
    conflict: number;
  };
  createCandidateIds: string[];
  noOpCandidateIds: string[];
  conflictCandidateIds: string[];
};

function sameDecision(existing: ExistingDecision, incoming: StoredDecision) {
  return (
    existing.status === incoming.status &&
    existing.note === incoming.note &&
    existing.binaryFit === incoming.checks.binaryFit &&
    existing.choiceParity === incoming.checks.choiceParity &&
    existing.duplicateReview === incoming.checks.duplicateReview &&
    existing.sourceReview === incoming.checks.sourceReview &&
    existing.reviewedAt.toISOString() === new Date(incoming.reviewedAt).toISOString()
  );
}

function createPlan(
  bundle: EditorialDecisionImportBundle,
  existingRows: ExistingDecision[],
  targetEnvironment: string,
): EditorialDecisionImportPlan {
  const existingByCandidate = new Map(existingRows.map((row) => [row.candidateId, row]));
  const createCandidateIds: string[] = [];
  const noOpCandidateIds: string[] = [];
  const conflictCandidateIds: string[] = [];

  for (const decision of bundle.store.decisions) {
    const existing = existingByCandidate.get(decision.candidateId);
    if (!existing) createCandidateIds.push(decision.candidateId);
    else if (sameDecision(existing, decision)) noOpCandidateIds.push(decision.candidateId);
    else conflictCandidateIds.push(decision.candidateId);
  }

  return {
    schemaVersion: 1,
    catalogId: bundle.store.catalogId,
    digest: bundle.digest,
    targetEnvironment,
    confirmation: `${targetEnvironment}:${bundle.store.catalogId}:${bundle.digest}`,
    summary: {
      total: bundle.store.decisions.length,
      create: createCandidateIds.length,
      noOp: noOpCandidateIds.length,
      conflict: conflictCandidateIds.length,
    },
    createCandidateIds,
    noOpCandidateIds,
    conflictCandidateIds,
  };
}

function assertUniqueCandidateIds(store: DecisionStore) {
  const seen = new Set<string>();
  for (const decision of store.decisions) {
    if (seen.has(decision.candidateId)) {
      throw new Error(`Decision store contains duplicate candidate ${decision.candidateId}.`);
    }
    seen.add(decision.candidateId);
  }
}

export async function loadEditorialDecisionImport(
  decisionsPath: string,
  catalogPath: string,
): Promise<EditorialDecisionImportBundle> {
  const [decisionBytes, catalogBytes] = await Promise.all([
    readFile(decisionsPath),
    readFile(catalogPath),
  ]);
  const store = decisionStoreSchema.parse(JSON.parse(decisionBytes.toString("utf8")) as unknown);
  const catalog = expandedEditorialCatalogSchema.parse(
    JSON.parse(catalogBytes.toString("utf8")) as unknown,
  );
  if (store.catalogId !== catalog.catalogId) {
    throw new Error("Decision store and Editorial Catalog IDs do not match.");
  }
  assertUniqueCandidateIds(store);
  const catalogCandidates = new Set(catalog.issues.map((issue) => issue.candidateId));
  const missing = store.decisions
    .map((decision) => decision.candidateId)
    .filter((candidateId) => !catalogCandidates.has(candidateId));
  if (missing.length > 0) {
    throw new Error(`Decision store references unknown candidates: ${missing.join(", ")}.`);
  }
  return {
    store,
    digest: createHash("sha256").update(decisionBytes).digest("hex"),
  };
}

async function readExistingDecisions(
  database: Database["db"],
  catalogId: string,
): Promise<ExistingDecision[]> {
  return database
    .select({
      candidateId: operatorEditorialDecisions.candidateId,
      status: operatorEditorialDecisions.status,
      note: operatorEditorialDecisions.note,
      binaryFit: operatorEditorialDecisions.binaryFit,
      choiceParity: operatorEditorialDecisions.choiceParity,
      duplicateReview: operatorEditorialDecisions.duplicateReview,
      sourceReview: operatorEditorialDecisions.sourceReview,
      reviewedAt: operatorEditorialDecisions.reviewedAt,
    })
    .from(operatorEditorialDecisions)
    .where(eq(operatorEditorialDecisions.catalogId, catalogId));
}

export async function planEditorialDecisionImport(
  database: Database["db"],
  bundle: EditorialDecisionImportBundle,
  targetEnvironment: string,
) {
  const existingRows = await readExistingDecisions(database, bundle.store.catalogId);
  return createPlan(bundle, existingRows, targetEnvironment);
}

export async function applyEditorialDecisionImport(input: {
  database: Database["db"];
  bundle: EditorialDecisionImportBundle;
  targetEnvironment: string;
  confirmation: string;
  operatorMemberId: string;
  actor: string;
}) {
  const expectedConfirmation = `${input.targetEnvironment}:${input.bundle.store.catalogId}:${input.bundle.digest}`;
  if (input.confirmation !== expectedConfirmation) {
    throw new Error(`Confirmation mismatch. Expected ${expectedConfirmation}`);
  }

  return input.database.transaction(async (transaction) => {
    const grants = await transaction
      .select({ id: operatorAccessGrants.id })
      .from(operatorAccessGrants)
      .where(
        and(
          eq(operatorAccessGrants.memberId, input.operatorMemberId),
          isNull(operatorAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grants[0]) throw new Error("Editorial import requires an active OPERATOR grant.");

    const existingRows = await transaction
      .select({
        candidateId: operatorEditorialDecisions.candidateId,
        status: operatorEditorialDecisions.status,
        note: operatorEditorialDecisions.note,
        binaryFit: operatorEditorialDecisions.binaryFit,
        choiceParity: operatorEditorialDecisions.choiceParity,
        duplicateReview: operatorEditorialDecisions.duplicateReview,
        sourceReview: operatorEditorialDecisions.sourceReview,
        reviewedAt: operatorEditorialDecisions.reviewedAt,
      })
      .from(operatorEditorialDecisions)
      .where(eq(operatorEditorialDecisions.catalogId, input.bundle.store.catalogId));
    const plan = createPlan(input.bundle, existingRows, input.targetEnvironment);
    if (plan.summary.conflict > 0) {
      throw new Error(
        `Import stopped because production has conflicting decisions: ${plan.conflictCandidateIds.join(", ")}.`,
      );
    }

    const createSet = new Set(plan.createCandidateIds);
    const values = input.bundle.store.decisions
      .filter((decision) => createSet.has(decision.candidateId))
      .map((decision) => ({
        catalogId: input.bundle.store.catalogId,
        candidateId: decision.candidateId,
        status: decision.status,
        note: decision.note,
        reviewedByMemberId: input.operatorMemberId,
        binaryFit: decision.checks.binaryFit,
        choiceParity: decision.checks.choiceParity,
        duplicateReview: decision.checks.duplicateReview,
        sourceReview: decision.checks.sourceReview,
        revision: 1,
        reviewedAt: new Date(decision.reviewedAt),
      }));
    if (values.length > 0) await transaction.insert(operatorEditorialDecisions).values(values);

    await transaction.insert(operatorAuditLogs).values({
      memberId: input.operatorMemberId,
      eventType: "OPS_EDITORIAL_DECISIONS_IMPORTED",
      outcome: "SUCCEEDED",
      metadata: {
        actor: input.actor,
        catalogId: input.bundle.store.catalogId,
        digest: input.bundle.digest,
        created: plan.summary.create,
        noOp: plan.summary.noOp,
      },
    });
    return plan;
  });
}
