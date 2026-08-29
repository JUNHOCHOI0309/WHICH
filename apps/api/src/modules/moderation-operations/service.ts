import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  commentModerationDecisions,
  issueMediaReviewDecisions,
  moderationActions,
  moderationAuditEvents,
  moderationCaseReferences,
  moderationCases,
  moderationReconciliations,
  moderationRuns,
  moderationTargets,
} from "../../database/schema/index.js";
import type { ModerationOperationsService, RecordModerationActionCommand } from "./contracts.js";

export class ModerationOperationsError extends Error {
  constructor(
    public readonly code:
      | "IDEMPOTENCY_CONFLICT"
      | "CASE_REVISION_CONFLICT"
      | "DOMAIN_DECISION_NOT_FOUND"
      | "REVIEWER_ASSIST_PROVISIONAL_REQUIRED",
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ModerationOperationsError";
  }
}

async function domainDecisionExists(
  database: Database["db"],
  command: RecordModerationActionCommand,
) {
  if (command.domainDecisionType === "COMMENT_MODERATION_DECISION") {
    const [row] = await database
      .select({ id: commentModerationDecisions.id })
      .from(commentModerationDecisions)
      .where(eq(commentModerationDecisions.id, command.domainDecisionId))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await database
    .select({ id: issueMediaReviewDecisions.id })
    .from(issueMediaReviewDecisions)
    .where(eq(issueMediaReviewDecisions.id, command.domainDecisionId))
    .limit(1);
  return Boolean(row);
}

export function createModerationOperationsService(
  database: Database["db"],
): ModerationOperationsService {
  return {
    async registerTarget(command) {
      const [created] = await database
        .insert(moderationTargets)
        .values(command)
        .onConflictDoNothing()
        .returning({ id: moderationTargets.id });
      if (created) return { created: true, id: created.id };

      const [existing] = await database
        .select()
        .from(moderationTargets)
        .where(
          and(
            eq(moderationTargets.targetType, command.targetType),
            eq(moderationTargets.targetId, command.targetId),
            eq(moderationTargets.targetVersion, command.targetVersion),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("The idempotent moderation target could not be loaded.");
      if (
        existing.inputHash !== command.inputHash ||
        existing.snapshotReference !== command.snapshotReference
      ) {
        throw new ModerationOperationsError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "This moderation target version was already registered with different evidence.",
        );
      }
      return { created: false, id: existing.id };
    },

    async recordRun(command) {
      const [created] = await database
        .insert(moderationRuns)
        .values({
          ...command,
          recheckRequestId: command.recheckRequestId,
          result: command.result ?? {},
          costMicros: command.costMicros ?? 0,
        })
        .onConflictDoNothing()
        .returning({ id: moderationRuns.id });
      if (created) return { created: true, id: created.id };

      const [existing] = await database
        .select()
        .from(moderationRuns)
        .where(
          and(
            eq(moderationRuns.targetId, command.targetId),
            eq(moderationRuns.policyVersion, command.policyVersion),
            eq(moderationRuns.stage, command.stage),
            eq(moderationRuns.normalizedInputHash, command.normalizedInputHash),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("The idempotent moderation run could not be loaded.");
      if (
        existing.ruleVersion !== command.ruleVersion ||
        existing.modelProvider !== (command.modelProvider ?? null) ||
        existing.modelName !== (command.modelName ?? null) ||
        existing.modelVersion !== (command.modelVersion ?? null)
      ) {
        throw new ModerationOperationsError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "This moderation execution key was already charged to a different executor.",
        );
      }
      return { created: false, id: existing.id };
    },

    async openCase(command) {
      const [created] = await database
        .insert(moderationCases)
        .values(command)
        .returning({ id: moderationCases.id, expectedRevision: moderationCases.expectedRevision });
      if (!created) throw new Error("The moderation case was not created.");
      return created;
    },

    async updateCase(command) {
      const { caseId, expectedRevision, ...changes } = command;
      const [updated] = await database
        .update(moderationCases)
        .set({
          ...changes,
          expectedRevision: sql`${moderationCases.expectedRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(moderationCases.id, caseId),
            eq(moderationCases.expectedRevision, expectedRevision),
          ),
        )
        .returning({ id: moderationCases.id, expectedRevision: moderationCases.expectedRevision });
      if (!updated) {
        throw new ModerationOperationsError(
          "CASE_REVISION_CONFLICT",
          409,
          "The moderation case changed after it was loaded.",
        );
      }
      return updated;
    },

    async linkCaseReference(command) {
      const [created] = await database
        .insert(moderationCaseReferences)
        .values(command)
        .onConflictDoNothing()
        .returning({ id: moderationCaseReferences.id });
      if (created) return { created: true, id: created.id };
      const [existing] = await database
        .select({ id: moderationCaseReferences.id })
        .from(moderationCaseReferences)
        .where(
          and(
            eq(moderationCaseReferences.caseId, command.caseId),
            eq(moderationCaseReferences.referenceType, command.referenceType),
            eq(moderationCaseReferences.referenceId, command.referenceId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("The case reference could not be loaded.");
      return { created: false, id: existing.id };
    },

    async recordAction(command) {
      if (!(await domainDecisionExists(database, command))) {
        throw new ModerationOperationsError(
          "DOMAIN_DECISION_NOT_FOUND",
          404,
          "The canonical domain moderation decision does not exist.",
        );
      }
      return database.transaction(async (transaction) => {
        const [action] = await transaction
          .insert(moderationActions)
          .values(command)
          .returning({ id: moderationActions.id });
        if (!action) throw new Error("The moderation action was not recorded.");
        await transaction.insert(moderationAuditEvents).values({
          eventType: "ACTION_RECORDED",
          entityType: "ACTION",
          entityId: action.id,
          actorType: command.actorType,
          actorMemberId: command.actorMemberId,
          metadata: {
            caseId: command.caseId,
            domainDecisionType: command.domainDecisionType,
            domainDecisionId: command.domainDecisionId,
          },
        });
        return action;
      });
    },

    async recordReconciliation(command) {
      return database.transaction(async (transaction) => {
        const [reconciliation] = await transaction
          .insert(moderationReconciliations)
          .values({
            caseId: command.caseId,
            targetId: command.targetId,
            resourceType: command.resourceType,
            expectedReference: command.expectedReference,
            observedReference: command.observedReference,
            status: command.status,
            repairReference: command.repairReference,
            resolvedAt: command.resolvedAt,
          })
          .returning({ id: moderationReconciliations.id });
        if (!reconciliation) throw new Error("The reconciliation record was not created.");
        await transaction.insert(moderationAuditEvents).values({
          eventType: `RECONCILIATION_${command.status}`,
          entityType: "RECONCILIATION",
          entityId: reconciliation.id,
          actorType: command.actorType,
          actorMemberId: command.actorMemberId,
          metadata: {
            targetId: command.targetId,
            resourceType: command.resourceType,
            expectedReference: command.expectedReference,
            observedReference: command.observedReference,
            repairReference: command.repairReference,
          },
        });
        return reconciliation;
      });
    },
  };
}
