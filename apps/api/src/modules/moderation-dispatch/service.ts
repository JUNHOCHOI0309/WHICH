import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  commentRevisions,
  comments,
  issueMediaAssets,
  issueMediaAssetVersions,
  issueVersionSnapshots,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  moderationAuditEvents,
  issueMediaRuleFindings,
  moderationProviderCallCache,
  moderationReconciliations,
  moderationRuns,
  moderationTargets,
  outboxEvents,
} from "../../database/schema/index.js";
import type { IssueMediaObjectStorage } from "../issue-media/contracts.js";
import { ModerationProviderCallError } from "../moderation-providers/contracts.js";
import { toImageProviderShadowFindings } from "../moderation-providers/image-shadow-findings.js";
import {
  createModerationSubmissionEvents,
  MODERATION_POLICY_VERSION,
  moderationRequestedEventSchema,
  type ModerationRequestedEvent,
  type ModerationShadowAdapter,
} from "./contracts.js";

export type ModerationDispatcherOptions = {
  batchSize: number;
  leaseMilliseconds: number;
  maxAttempts: number;
  retryBaseMilliseconds: number;
  retryMaxMilliseconds: number;
  policyVersion?: string;
  ruleVersion?: string;
  now?: () => Date;
  providerGate?: ModerationProviderGate;
};

export type ModerationProviderGate = (input: {
  targetType: ModerationRequestedEvent["data"]["target_type"];
  targetId: string;
  targetVersion: number;
  normalizedInputHash: string;
  policyVersion: string;
}) => Promise<{ allowed: boolean; reason: string }> | { allowed: boolean; reason: string };

const MAX_ERROR_LENGTH = 2_000;

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown moderation worker failure.").slice(
    0,
    MAX_ERROR_LENGTH,
  );
}

function safeLimit(value: number | undefined, fallback: number) {
  return Math.max(1, Math.min(value ?? fallback, 500));
}

export function createModerationDispatcherService(
  database: Database["db"],
  adapter: ModerationShadowAdapter | null,
  options: ModerationDispatcherOptions,
) {
  const now = options.now ?? (() => new Date());
  const policyVersion = options.policyVersion ?? MODERATION_POLICY_VERSION;
  const ruleVersion = options.ruleVersion ?? "moderation-dispatch-v1";

  function retryDelay(attemptCount: number) {
    return Math.min(
      options.retryBaseMilliseconds * 2 ** Math.max(0, attemptCount - 1),
      options.retryMaxMilliseconds,
    );
  }

  async function inspectTarget(event: ModerationRequestedEvent) {
    const target = event.data;
    if (target.target_type === "COMMENT_VERSION") {
      const [row] = await database
        .select({
          inputHash: commentRevisions.inputHash,
          currentRevision: comments.bodyRevision,
          deletedAt: comments.deletedAt,
        })
        .from(commentRevisions)
        .innerJoin(comments, eq(comments.id, commentRevisions.commentId))
        .where(
          and(
            eq(commentRevisions.commentId, target.target_id),
            eq(commentRevisions.revision, target.target_version),
          ),
        )
        .limit(1);
      if (!row) return { exists: false, staleReason: "TARGET_VERSION_NOT_FOUND" } as const;
      if (row.inputHash !== target.normalized_input_hash) {
        return { exists: true, staleReason: "INPUT_HASH_CHANGED" } as const;
      }
      if (row.deletedAt || row.currentRevision !== target.target_version) {
        return { exists: true, staleReason: "TARGET_REPLACED_OR_REMOVED" } as const;
      }
      return { exists: true, staleReason: null } as const;
    }
    if (target.target_type === "ISSUE_VERSION") {
      const [row] = await database
        .select({ inputHash: issueVersionSnapshots.inputHash })
        .from(issueVersionSnapshots)
        .where(
          and(
            eq(issueVersionSnapshots.issueId, target.target_id),
            eq(issueVersionSnapshots.issueVersion, target.target_version),
          ),
        )
        .limit(1);
      if (!row) {
        const [submission] = await database
          .select({
            inputHash: memberIssueSubmissionRevisions.contentHash,
            currentRevision: memberIssueSubmissions.revision,
            status: memberIssueSubmissions.status,
            publishedIssueId: memberIssueSubmissions.publishedIssueId,
          })
          .from(memberIssueSubmissionRevisions)
          .innerJoin(
            memberIssueSubmissions,
            eq(memberIssueSubmissions.id, memberIssueSubmissionRevisions.submissionId),
          )
          .where(
            and(
              eq(memberIssueSubmissionRevisions.submissionId, target.target_id),
              eq(memberIssueSubmissionRevisions.revision, target.target_version),
            ),
          )
          .limit(1);
        if (!submission) {
          return { exists: false, staleReason: "TARGET_VERSION_NOT_FOUND" } as const;
        }
        return {
          exists: true,
          staleReason:
            submission.inputHash !== target.normalized_input_hash
              ? "INPUT_HASH_CHANGED"
              : submission.currentRevision !== target.target_version ||
                  submission.status === "CANCELLED" ||
                  Boolean(submission.publishedIssueId)
                ? "TARGET_REPLACED_OR_REMOVED"
                : null,
        } as const;
      }
      return {
        exists: true,
        staleReason: row.inputHash === target.normalized_input_hash ? null : "INPUT_HASH_CHANGED",
      } as const;
    }
    const [row] = await database
      .select({
        inputHash: issueMediaAssetVersions.inputHash,
        storageState: issueMediaAssets.storageState,
      })
      .from(issueMediaAssetVersions)
      .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaAssetVersions.assetId))
      .where(
        and(
          eq(issueMediaAssetVersions.assetId, target.target_id),
          eq(issueMediaAssetVersions.version, target.target_version),
        ),
      )
      .limit(1);
    if (!row) return { exists: false, staleReason: "TARGET_VERSION_NOT_FOUND" } as const;
    if (row.inputHash !== target.normalized_input_hash) {
      return { exists: true, staleReason: "INPUT_HASH_CHANGED" } as const;
    }
    return {
      exists: true,
      staleReason: row.storageState === "PURGED" ? "TARGET_REMOVED" : null,
    } as const;
  }

  async function markOutboxFailure(
    row: typeof outboxEvents.$inferSelect,
    claimToken: string,
    error: unknown,
  ) {
    const failedAt = now();
    const deadLettered = row.attemptCount >= options.maxAttempts;
    await database
      .update(outboxEvents)
      .set({
        status: deadLettered ? "FAILED" : "PENDING",
        availableAt: deadLettered
          ? failedAt
          : new Date(failedAt.getTime() + retryDelay(row.attemptCount)),
        claimToken: null,
        claimedAt: null,
        deadLetteredAt: deadLettered ? failedAt : null,
        lastError: errorMessage(error),
      })
      .where(
        and(
          eq(outboxEvents.id, row.id),
          eq(outboxEvents.status, "PENDING"),
          eq(outboxEvents.claimToken, claimToken),
        ),
      );
    return deadLettered;
  }

  async function dispatchEvent(row: typeof outboxEvents.$inferSelect, claimToken: string) {
    const event = moderationRequestedEventSchema.parse(row.payload);
    const targetState = await inspectTarget(event);
    const staleReason =
      event.data.policy_version !== policyVersion
        ? "POLICY_VERSION_CHANGED"
        : targetState.staleReason;

    await database.transaction(async (transaction) => {
      const [createdTarget] = await transaction
        .insert(moderationTargets)
        .values({
          targetType: event.data.target_type,
          targetId: event.data.target_id,
          targetVersion: event.data.target_version,
          inputHash: event.data.normalized_input_hash,
          snapshotReference: event.data.private_object_reference,
        })
        .onConflictDoNothing()
        .returning({ id: moderationTargets.id });
      const [storedTarget] = createdTarget
        ? [createdTarget]
        : await transaction
            .select({ id: moderationTargets.id })
            .from(moderationTargets)
            .where(
              and(
                eq(moderationTargets.targetType, event.data.target_type),
                eq(moderationTargets.targetId, event.data.target_id),
                eq(moderationTargets.targetVersion, event.data.target_version),
              ),
            )
            .limit(1);
      if (!storedTarget) throw new Error("The moderation target could not be registered.");

      const [run] = await transaction
        .insert(moderationRuns)
        .values({
          targetId: storedTarget.id,
          sourceEventId: row.id,
          policyVersion: event.data.policy_version,
          stage: "SHADOW_DISPATCH",
          mode: "SHADOW",
          normalizedInputHash: event.data.normalized_input_hash,
          ruleVersion,
          status: staleReason ? "SKIPPED" : "PENDING",
          availableAt: now(),
          decisionSource: "SYSTEM",
          result: staleReason
            ? { shadow: true, stale: true, reason: staleReason, publicationChanged: false }
            : { shadow: true, publicationChanged: false },
          completedAt: staleReason ? now() : undefined,
          updatedAt: now(),
        })
        .onConflictDoNothing()
        .returning({ id: moderationRuns.id });

      if (run) {
        await transaction.insert(moderationAuditEvents).values({
          eventType: staleReason ? "SHADOW_RUN_SKIPPED_STALE" : "SHADOW_RUN_QUEUED",
          entityType: "RUN",
          entityId: run.id,
          actorType: "SYSTEM",
          metadata: { sourceEventId: row.id, staleReason, mode: "SHADOW" },
        });
      }

      if (staleReason === "POLICY_VERSION_CHANGED" && targetState.exists) {
        const events = createModerationSubmissionEvents({
          targetType: event.data.target_type,
          targetId: event.data.target_id,
          targetVersion: event.data.target_version,
          privateObjectReference: event.data.private_object_reference,
          normalizedInputHash: event.data.normalized_input_hash,
          policyVersion,
          reason: "POLICY_CHANGE",
          occurredAt: now(),
        });
        await transaction.insert(outboxEvents).values(events.rows);
      }

      await transaction
        .update(outboxEvents)
        .set({
          status: "PUBLISHED",
          publishedAt: now(),
          claimToken: null,
          claimedAt: null,
          lastError: null,
        })
        .where(
          and(
            eq(outboxEvents.id, row.id),
            eq(outboxEvents.status, "PENDING"),
            eq(outboxEvents.claimToken, claimToken),
          ),
        );
    });
    return staleReason ? "SKIPPED" : "QUEUED";
  }

  async function claimOutbox(limit?: number) {
    return database.transaction(async (transaction) => {
      const claimedAt = now();
      const candidates = await transaction
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.status, "PENDING"),
            eq(outboxEvents.eventType, "MODERATION_REQUESTED"),
            lte(outboxEvents.availableAt, claimedAt),
          ),
        )
        .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
        .limit(safeLimit(limit, options.batchSize))
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const claimToken = randomUUID();
      const rows = await transaction
        .update(outboxEvents)
        .set({
          claimToken,
          claimedAt,
          availableAt: new Date(claimedAt.getTime() + options.leaseMilliseconds),
          attemptCount: sql`${outboxEvents.attemptCount} + 1`,
          totalAttemptCount: sql`${outboxEvents.totalAttemptCount} + 1`,
        })
        .where(
          inArray(
            outboxEvents.id,
            candidates.map(({ id }) => id),
          ),
        )
        .returning();
      return rows.map((row) => ({ row, claimToken }));
    });
  }

  async function claimRuns(limit?: number) {
    return database.transaction(async (transaction) => {
      const claimedAt = now();
      const candidates = await transaction
        .select({ id: moderationRuns.id })
        .from(moderationRuns)
        .where(
          or(
            and(eq(moderationRuns.status, "PENDING"), lte(moderationRuns.availableAt, claimedAt)),
            and(eq(moderationRuns.status, "RUNNING"), lte(moderationRuns.availableAt, claimedAt)),
          ),
        )
        .orderBy(asc(moderationRuns.availableAt), asc(moderationRuns.createdAt))
        .limit(safeLimit(limit, options.batchSize))
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const claimToken = randomUUID();
      return transaction
        .update(moderationRuns)
        .set({
          status: "RUNNING",
          claimToken,
          claimedAt,
          availableAt: new Date(claimedAt.getTime() + options.leaseMilliseconds),
          attemptCount: sql`${moderationRuns.attemptCount} + 1`,
          totalAttemptCount: sql`${moderationRuns.totalAttemptCount} + 1`,
          startedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .where(
          inArray(
            moderationRuns.id,
            candidates.map(({ id }) => id),
          ),
        )
        .returning();
    });
  }

  async function executeRun(run: typeof moderationRuns.$inferSelect) {
    if (!run.claimToken) throw new Error("The moderation Run has no lease token.");
    const [target] = await database
      .select()
      .from(moderationTargets)
      .where(eq(moderationTargets.id, run.targetId))
      .limit(1);
    if (!target) throw new Error("The moderation target is missing.");

    const event = {
      event_id: run.sourceEventId ?? randomUUID(),
      event_type: "MODERATION_REQUESTED" as const,
      schema_version: 1 as const,
      occurred_at: run.createdAt.toISOString(),
      aggregate_type: "MODERATION_TARGET" as const,
      aggregate_id: `${target.targetType}:${target.targetId}:${target.targetVersion}`,
      data: {
        source_event_id: run.sourceEventId ?? randomUUID(),
        target_type: target.targetType as ModerationRequestedEvent["data"]["target_type"],
        target_id: target.targetId,
        target_version: target.targetVersion,
        private_object_reference: target.snapshotReference,
        normalized_input_hash: target.inputHash,
        policy_version: run.policyVersion,
        reason: "CREATE" as const,
        mode: "SHADOW" as const,
      },
    };
    const targetState = await inspectTarget(event);
    if (targetState.staleReason) {
      return {
        status: "SKIPPED" as const,
        result: {
          shadow: true,
          stale: true,
          reason: targetState.staleReason,
          publicationChanged: false,
        },
        latencyMs: 0,
        costMicros: 0,
      };
    }

    if (!adapter) {
      return {
        status: "SKIPPED" as const,
        result: {
          shadow: true,
          reason: "PROVIDER_DISABLED",
          signals: [],
          publicationChanged: false,
        },
        latencyMs: 0,
        costMicros: 0,
      };
    }
    const gate = options.providerGate
      ? await options.providerGate({
          targetType: event.data.target_type,
          targetId: target.targetId,
          targetVersion: target.targetVersion,
          normalizedInputHash: run.normalizedInputHash,
          policyVersion: run.policyVersion,
        })
      : { allowed: false, reason: "PROVIDER_GATE_REQUIRED" };
    if (!gate.allowed) {
      return {
        status: "SKIPPED" as const,
        result: {
          shadow: true,
          reason: gate.reason,
          signals: [],
          publicationChanged: false,
        },
        latencyMs: 0,
        costMicros: 0,
      };
    }

    const [cached] = await database
      .select()
      .from(moderationProviderCallCache)
      .where(
        and(
          eq(moderationProviderCallCache.provider, adapter.provider),
          eq(moderationProviderCallCache.modelName, adapter.modelName),
          eq(moderationProviderCallCache.modelVersion, adapter.modelVersion),
          eq(moderationProviderCallCache.policyVersion, run.policyVersion),
          eq(moderationProviderCallCache.normalizedInputHash, run.normalizedInputHash),
          gt(moderationProviderCallCache.expiresAt, now()),
        ),
      )
      .limit(1);
    if (cached) {
      return {
        status: cached.status as "SUCCEEDED" | "SKIPPED",
        result: { ...cached.result, cacheHit: true, shadow: true, publicationChanged: false },
        latencyMs: cached.latencyMs,
        costMicros: 0,
      };
    }

    const inspected = await adapter.inspect({
      targetType: event.data.target_type,
      targetId: target.targetId,
      targetVersion: target.targetVersion,
      privateObjectReference: target.snapshotReference,
      normalizedInputHash: run.normalizedInputHash,
      policyVersion: run.policyVersion,
    });
    await database
      .insert(moderationProviderCallCache)
      .values({
        provider: adapter.provider,
        modelName: adapter.modelName,
        modelVersion: adapter.modelVersion,
        policyVersion: run.policyVersion,
        normalizedInputHash: run.normalizedInputHash,
        status: inspected.status,
        result: inspected.result,
        latencyMs: inspected.latencyMs,
        costMicros: inspected.costMicros,
        expiresAt: new Date(now().getTime() + adapter.cacheTtlMilliseconds),
      })
      .onConflictDoNothing();
    return {
      ...inspected,
      result: { ...inspected.result, cacheHit: false, shadow: true, publicationChanged: false },
    };
  }

  async function completeRun(
    run: typeof moderationRuns.$inferSelect,
    result: Awaited<ReturnType<typeof executeRun>>,
  ) {
    const completedAt = now();
    await database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(moderationRuns)
        .set({
          status: result.status,
          result: result.result,
          latencyMs: result.latencyMs,
          costMicros: result.costMicros,
          modelProvider: adapter?.provider,
          modelName: adapter?.modelName,
          modelVersion: adapter?.modelVersion,
          completedAt,
          claimToken: null,
          claimedAt: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(moderationRuns.id, run.id),
            eq(moderationRuns.status, "RUNNING"),
            eq(moderationRuns.claimToken, run.claimToken!),
          ),
        )
        .returning({ id: moderationRuns.id });
      if (updated) {
        const [target] = await transaction
          .select({
            targetType: moderationTargets.targetType,
            targetId: moderationTargets.targetId,
          })
          .from(moderationTargets)
          .where(eq(moderationTargets.id, run.targetId))
          .limit(1);
        if (target?.targetType === "ISSUE_MEDIA_ASSET" && result.status === "SUCCEEDED") {
          const findings = toImageProviderShadowFindings({
            result: result.result,
            policyVersion: run.policyVersion,
            cacheHit: result.result.cacheHit === true,
          });
          if (findings.length > 0) {
            await transaction.insert(issueMediaRuleFindings).values(
              findings.map((finding) => ({
                mediaAssetId: target.targetId,
                ...finding,
              })),
            );
          }
        }
        await transaction.insert(moderationAuditEvents).values({
          eventType: `SHADOW_RUN_${result.status}`,
          entityType: "RUN",
          entityId: run.id,
          actorType: "SYSTEM",
          metadata: {
            mode: "SHADOW",
            costMicros: result.costMicros,
            publicationChanged: false,
          },
        });
      }
    });
  }

  async function failRun(run: typeof moderationRuns.$inferSelect, error: unknown) {
    if (!run.claimToken) return "STALE" as const;
    const failedAt = now();
    const deadLettered = run.attemptCount >= options.maxAttempts;
    const [updated] = await database
      .update(moderationRuns)
      .set({
        status: deadLettered ? "DEAD_LETTERED" : "PENDING",
        availableAt: deadLettered
          ? failedAt
          : new Date(failedAt.getTime() + retryDelay(run.attemptCount)),
        claimToken: null,
        claimedAt: null,
        deadLetteredAt: deadLettered ? failedAt : null,
        errorCode:
          error instanceof ModerationProviderCallError
            ? `PROVIDER_${error.kind}`
            : "SHADOW_EXECUTION_FAILED",
        errorMessage: errorMessage(error),
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(moderationRuns.id, run.id),
          eq(moderationRuns.status, "RUNNING"),
          eq(moderationRuns.claimToken, run.claimToken),
        ),
      )
      .returning({ id: moderationRuns.id });
    return updated ? (deadLettered ? "DEAD_LETTERED" : "RETRIED") : "STALE";
  }

  return {
    async dispatchBatch(limit?: number) {
      const claimed = await claimOutbox(limit);
      const summary = {
        claimed: claimed.length,
        queued: 0,
        skipped: 0,
        retried: 0,
        deadLettered: 0,
      };
      for (const { row, claimToken } of claimed) {
        try {
          const outcome = await dispatchEvent(row, claimToken);
          if (outcome === "QUEUED") summary.queued += 1;
          else summary.skipped += 1;
        } catch (error) {
          if (await markOutboxFailure(row, claimToken, error)) summary.deadLettered += 1;
          else summary.retried += 1;
        }
      }
      return summary;
    },

    async processBatch(limit?: number) {
      const runs = await claimRuns(limit);
      const summary = {
        claimed: runs.length,
        succeeded: 0,
        skipped: 0,
        retried: 0,
        deadLettered: 0,
      };
      for (const run of runs) {
        try {
          const result = await executeRun(run);
          await completeRun(run, result);
          if (result.status === "SUCCEEDED") summary.succeeded += 1;
          else summary.skipped += 1;
        } catch (error) {
          const outcome = await failRun(run, error);
          if (outcome === "RETRIED") summary.retried += 1;
          if (outcome === "DEAD_LETTERED") summary.deadLettered += 1;
        }
      }
      return summary;
    },

    async listDeadLetters(limit?: number) {
      return database
        .select()
        .from(moderationRuns)
        .where(eq(moderationRuns.status, "DEAD_LETTERED"))
        .orderBy(asc(moderationRuns.deadLetteredAt))
        .limit(safeLimit(limit, options.batchSize));
    },

    async requeueDeadLetter(runId: string) {
      const requeuedAt = now();
      const [run] = await database
        .update(moderationRuns)
        .set({
          status: "PENDING",
          attemptCount: 0,
          availableAt: requeuedAt,
          deadLetteredAt: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: requeuedAt,
        })
        .where(and(eq(moderationRuns.id, runId), eq(moderationRuns.status, "DEAD_LETTERED")))
        .returning({ id: moderationRuns.id });
      return run ?? null;
    },

    async reconcileMedia(storage: IssueMediaObjectStorage, limit?: number) {
      const rows = await database
        .select({
          id: issueMediaAssets.id,
          storageState: issueMediaAssets.storageState,
          stagingObjectKey: issueMediaAssets.stagingObjectKey,
          publishedObjectKey: issueMediaAssets.publishedObjectKey,
          quarantinedObjectKey: issueMediaAssets.quarantinedObjectKey,
          updatedAt: issueMediaAssets.updatedAt,
          assetVersion: issueMediaAssetVersions.version,
          inputHash: issueMediaAssetVersions.inputHash,
          snapshotReference: issueMediaAssetVersions.normalizedObjectRef,
        })
        .from(issueMediaAssets)
        .innerJoin(
          issueMediaAssetVersions,
          and(
            eq(issueMediaAssetVersions.assetId, issueMediaAssets.id),
            eq(issueMediaAssetVersions.version, 1),
          ),
        )
        .where(
          and(
            inArray(issueMediaAssets.storageState, ["STAGED", "PUBLISHED", "QUARANTINED"]),
            or(
              isNotNull(issueMediaAssets.stagingObjectKey),
              isNotNull(issueMediaAssets.publishedObjectKey),
              isNotNull(issueMediaAssets.quarantinedObjectKey),
            ),
          ),
        )
        .orderBy(asc(issueMediaAssets.updatedAt))
        .limit(safeLimit(limit, options.batchSize));
      const summary = { checked: rows.length, consistent: 0, repaired: 0, failed: 0 };
      for (const row of rows) {
        const objectKey =
          row.storageState === "PUBLISHED"
            ? row.publishedObjectKey
            : row.storageState === "QUARANTINED"
              ? row.quarantinedObjectKey
              : row.stagingObjectKey;
        if (!objectKey) continue;
        try {
          const exists = storage.exists
            ? await storage.exists(objectKey)
            : await storage.read(objectKey).then(
                () => true,
                () => false,
              );
          const [createdTarget] = await database
            .insert(moderationTargets)
            .values({
              targetType: "ISSUE_MEDIA_ASSET",
              targetId: row.id,
              targetVersion: row.assetVersion,
              inputHash: row.inputHash,
              snapshotReference: row.snapshotReference,
            })
            .onConflictDoNothing()
            .returning({ id: moderationTargets.id });
          const [target] = createdTarget
            ? [createdTarget]
            : await database
                .select({ id: moderationTargets.id })
                .from(moderationTargets)
                .where(
                  and(
                    eq(moderationTargets.targetType, "ISSUE_MEDIA_ASSET"),
                    eq(moderationTargets.targetId, row.id),
                    eq(moderationTargets.targetVersion, row.assetVersion),
                  ),
                )
                .limit(1);
          if (!target) throw new Error("The media reconciliation target could not be registered.");
          if (exists) {
            summary.consistent += 1;
            await database.insert(moderationReconciliations).values({
              targetId: target.id,
              resourceType: "R2",
              expectedReference: objectKey,
              observedReference: objectKey,
              status: "CONSISTENT",
              resolvedAt: now(),
            });
          } else {
            const repairedAt = now();
            await database.transaction(async (transaction) => {
              await transaction
                .update(issueMediaAssets)
                .set({
                  storageState: "PURGED",
                  processingState: "FAILED",
                  moderationState: "REVOKED",
                  stagingObjectKey: null,
                  publishedObjectKey: null,
                  quarantinedObjectKey: null,
                  purgedAt: repairedAt,
                  updatedAt: repairedAt,
                })
                .where(eq(issueMediaAssets.id, row.id));
              await transaction.insert(moderationReconciliations).values({
                targetId: target.id,
                resourceType: "R2",
                expectedReference: objectKey,
                status: "REPAIRED",
                repairReference: "fail-closed:asset-purged-after-missing-object",
                resolvedAt: repairedAt,
              });
            });
            summary.repaired += 1;
          }
        } catch {
          summary.failed += 1;
        }
      }
      return summary;
    },
  };
}
