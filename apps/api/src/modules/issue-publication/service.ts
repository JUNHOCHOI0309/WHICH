import { randomUUID } from "node:crypto";

import { and, eq, inArray, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoices,
  issueInterestCards,
  issues,
  issueVersions,
  outboxEvents,
  resultSnapshots,
  voteAggregates,
} from "../../database/schema/index.js";
import type {
  IssuePublicationPlan,
  IssuePublicationPlanItem,
  IssuePublicationResult,
} from "./contracts.js";
import type { IssueManifest, IssueManifestItem, IssuePublicationTarget } from "./manifest.js";

type PublicationQueryExecutor = Pick<Database["db"], "select" | "insert" | "execute">;

function issueVersionKey(issueId: string, issueVersion: number) {
  return `${issueId}:${issueVersion}`;
}

function sameTimestamp(actual: Date | null, expected: string) {
  return actual?.toISOString() === new Date(expected).toISOString();
}

function addMismatch(reasons: string[], path: string, actual: unknown, expected: unknown) {
  if (actual !== expected) reasons.push(`${path} differs from the approved Manifest.`);
}

function summarize(items: IssuePublicationPlanItem[]) {
  return {
    create: items.filter((item) => item.action === "CREATE").length,
    noOp: items.filter((item) => item.action === "NOOP").length,
    conflict: items.filter((item) => item.action === "CONFLICT").length,
  };
}

async function inspectIssueManifest(
  database: PublicationQueryExecutor,
  manifest: IssueManifest,
  manifestDigest: string,
): Promise<IssuePublicationPlan> {
  const issueIds = manifest.issues.map((issue) => issue.id);
  const choiceIds = manifest.issues.flatMap((issue) => issue.choices.map((choice) => choice.id));

  const storedIssues = await database
    .select({
      id: issues.id,
      successorIssueId: issues.successorIssueId,
      lifecycle: issues.lifecycle,
      visibility: issues.visibility,
      participation: issues.participation,
      resultVisibility: issues.resultVisibility,
      feedEligibility: issues.feedEligibility,
      riskLevel: issues.riskLevel,
      isPolitical: issues.isPolitical,
      voteOpenAt: issues.voteOpenAt,
      voteCloseAt: issues.voteCloseAt,
    })
    .from(issues)
    .where(inArray(issues.id, issueIds));

  const storedVersions = await database
    .select({
      issueId: issueVersions.issueId,
      version: issueVersions.version,
      question: issueVersions.question,
      context: issueVersions.context,
      contentHash: issueVersions.contentHash,
      primaryCategoryCode: issueVersions.primaryCategoryCode,
      experienceModeCode: issueVersions.experienceModeCode,
      taxonomyVersion: issueVersions.taxonomyVersion,
      publishedAt: issueVersions.publishedAt,
    })
    .from(issueVersions)
    .where(inArray(issueVersions.issueId, issueIds));

  const storedInterestCards = await database
    .select({
      issueId: issueInterestCards.issueId,
      issueVersion: issueInterestCards.issueVersion,
      cardCode: issueInterestCards.cardCode,
      taxonomyVersion: issueInterestCards.taxonomyVersion,
      weight: issueInterestCards.weight,
    })
    .from(issueInterestCards)
    .where(inArray(issueInterestCards.issueId, issueIds));

  const storedChoices = await database
    .select({
      id: issueChoices.id,
      issueId: issueChoices.issueId,
      issueVersion: issueChoices.issueVersion,
      code: issueChoices.code,
      label: issueChoices.label,
    })
    .from(issueChoices)
    .where(or(inArray(issueChoices.issueId, issueIds), inArray(issueChoices.id, choiceIds)));

  const storedAggregates = await database
    .select({
      issueId: voteAggregates.issueId,
      issueVersion: voteAggregates.issueVersion,
    })
    .from(voteAggregates)
    .where(inArray(voteAggregates.issueId, issueIds));

  const storedBaselines = await database
    .select({
      issueId: resultSnapshots.issueId,
      issueVersion: resultSnapshots.issueVersion,
      resultVersion: resultSnapshots.resultVersion,
      acceptedACount: resultSnapshots.acceptedACount,
      acceptedBCount: resultSnapshots.acceptedBCount,
      displayedVoteCount: resultSnapshots.displayedVoteCount,
      integrityState: resultSnapshots.integrityState,
    })
    .from(resultSnapshots)
    .where(and(inArray(resultSnapshots.issueId, issueIds), eq(resultSnapshots.resultVersion, 1)));

  const issueById = new Map(storedIssues.map((issue) => [issue.id, issue]));
  const versionByKey = new Map(
    storedVersions.map((version) => [issueVersionKey(version.issueId, version.version), version]),
  );
  const choicesByVersion = new Map<string, typeof storedChoices>();
  for (const choice of storedChoices) {
    const key = issueVersionKey(choice.issueId, choice.issueVersion);
    const grouped = choicesByVersion.get(key) ?? [];
    grouped.push(choice);
    choicesByVersion.set(key, grouped);
  }
  const interestCardsByVersion = new Map<string, typeof storedInterestCards>();
  for (const card of storedInterestCards) {
    const key = issueVersionKey(card.issueId, card.issueVersion);
    const grouped = interestCardsByVersion.get(key) ?? [];
    grouped.push(card);
    interestCardsByVersion.set(key, grouped);
  }
  const choiceById = new Map(storedChoices.map((choice) => [choice.id, choice]));
  const aggregateByKey = new Map(
    storedAggregates.map((aggregate) => [
      issueVersionKey(aggregate.issueId, aggregate.issueVersion),
      aggregate,
    ]),
  );
  const baselineByKey = new Map(
    storedBaselines.map((snapshot) => [
      issueVersionKey(snapshot.issueId, snapshot.issueVersion),
      snapshot,
    ]),
  );

  const planItems = manifest.issues.map<IssuePublicationPlanItem>((expected) => {
    const key = issueVersionKey(expected.id, expected.version);
    const storedIssue = issueById.get(expected.id);
    const storedVersion = versionByKey.get(key);
    const versionChoices = [...(choicesByVersion.get(key) ?? [])].sort((left, right) =>
      left.code.localeCompare(right.code),
    );
    const versionInterestCards = [...(interestCardsByVersion.get(key) ?? [])].sort((left, right) =>
      left.cardCode.localeCompare(right.cardCode),
    );
    const storedAggregate = aggregateByKey.get(key);
    const storedBaseline = baselineByKey.get(key);
    const foreignChoiceConflicts = expected.choices.filter((choice) => {
      const storedChoice = choiceById.get(choice.id);
      return (
        storedChoice &&
        (storedChoice.issueId !== expected.id || storedChoice.issueVersion !== expected.version)
      );
    });

    const hasAnyExistingState =
      Boolean(storedIssue) ||
      Boolean(storedVersion) ||
      versionChoices.length > 0 ||
      versionInterestCards.length > 0 ||
      Boolean(storedAggregate) ||
      Boolean(storedBaseline) ||
      foreignChoiceConflicts.length > 0;

    if (!hasAnyExistingState) {
      return {
        issueId: expected.id,
        issueVersion: expected.version,
        action: "CREATE",
        reasons: [],
      };
    }

    const reasons: string[] = [];
    if (!storedIssue) {
      reasons.push("Issue row is missing while dependent or colliding state already exists.");
    } else {
      addMismatch(reasons, "issue.successorIssueId", storedIssue.successorIssueId, null);
      addMismatch(reasons, "issue.lifecycle", storedIssue.lifecycle, expected.lifecycle);
      addMismatch(reasons, "issue.visibility", storedIssue.visibility, expected.visibility);
      addMismatch(
        reasons,
        "issue.participation",
        storedIssue.participation,
        expected.participation,
      );
      addMismatch(
        reasons,
        "issue.resultVisibility",
        storedIssue.resultVisibility,
        expected.resultVisibility,
      );
      addMismatch(
        reasons,
        "issue.feedEligibility",
        storedIssue.feedEligibility,
        expected.feedEligibility,
      );
      addMismatch(reasons, "issue.riskLevel", storedIssue.riskLevel, expected.riskLevel);
      addMismatch(reasons, "issue.isPolitical", storedIssue.isPolitical, expected.isPolitical);
      if (!sameTimestamp(storedIssue.voteOpenAt, expected.voteOpenAt)) {
        reasons.push("issue.voteOpenAt differs from the approved Manifest.");
      }
      addMismatch(reasons, "issue.voteCloseAt", storedIssue.voteCloseAt, null);
    }

    if (!storedVersion) {
      reasons.push("Issue Version row is missing.");
    } else {
      addMismatch(reasons, "version.question", storedVersion.question, expected.question);
      addMismatch(reasons, "version.context", storedVersion.context, expected.context);
      addMismatch(reasons, "version.contentHash", storedVersion.contentHash, expected.contentHash);
      addMismatch(
        reasons,
        "version.primaryCategoryCode",
        storedVersion.primaryCategoryCode,
        expected.primaryCategoryCode,
      );
      addMismatch(
        reasons,
        "version.experienceModeCode",
        storedVersion.experienceModeCode,
        expected.experienceModeCode,
      );
      addMismatch(
        reasons,
        "version.taxonomyVersion",
        storedVersion.taxonomyVersion,
        expected.taxonomyVersion,
      );
      if (!sameTimestamp(storedVersion.publishedAt, expected.publishedAt)) {
        reasons.push("version.publishedAt differs from the approved Manifest.");
      }
    }

    if (versionChoices.length !== 2) {
      reasons.push("Issue Version does not contain exactly two Choices.");
    } else {
      expected.choices.forEach((expectedChoice, index) => {
        const storedChoice = versionChoices[index];
        if (!storedChoice) return;
        addMismatch(reasons, `choices.${index}.id`, storedChoice.id, expectedChoice.id);
        addMismatch(reasons, `choices.${index}.code`, storedChoice.code, expectedChoice.code);
        addMismatch(reasons, `choices.${index}.label`, storedChoice.label, expectedChoice.label);
      });
    }

    if (foreignChoiceConflicts.length > 0) {
      reasons.push("One or more Choice IDs are already owned by another Issue Version.");
    }
    const expectedInterestCards = [...expected.interestCardCodes].sort();
    if (
      versionInterestCards.length !== expectedInterestCards.length ||
      versionInterestCards.some(
        (card, index) =>
          card.cardCode !== expectedInterestCards[index] ||
          card.taxonomyVersion !== "interest_cards_v1" ||
          card.weight !== 100,
      )
    ) {
      reasons.push("Issue Interest Card mapping differs from the approved Manifest.");
    }
    if (!storedAggregate) reasons.push("Zero-result Aggregate baseline is missing.");
    if (!storedBaseline) {
      reasons.push("Zero-result Snapshot baseline is missing.");
    } else if (
      storedBaseline.acceptedACount !== 0 ||
      storedBaseline.acceptedBCount !== 0 ||
      storedBaseline.displayedVoteCount !== 0 ||
      storedBaseline.integrityState !== "NORMAL"
    ) {
      reasons.push("Result Snapshot version 1 is not the expected zero-result baseline.");
    }

    return {
      issueId: expected.id,
      issueVersion: expected.version,
      action: reasons.length === 0 ? "NOOP" : "CONFLICT",
      reasons,
    };
  });

  return {
    schemaVersion: 1,
    packId: manifest.packId,
    manifestDigest,
    target: manifest.target,
    summary: summarize(planItems),
    issues: planItems,
  };
}

export class IssuePublicationConflictError extends Error {
  constructor(readonly plan: IssuePublicationPlan) {
    super(`Issue Pack ${plan.packId} conflicts with existing database state.`);
    this.name = "IssuePublicationConflictError";
  }
}

export function assertIssuePublicationTarget(
  manifest: IssueManifest,
  target: IssuePublicationTarget,
) {
  if (manifest.target !== target) {
    throw new Error(`Target mismatch: Manifest is approved for ${manifest.target}, not ${target}.`);
  }
}

export function assertIssuePublicationConfirmation(
  manifest: IssueManifest,
  target: IssuePublicationTarget,
  manifestDigest: string,
  confirmation: string | undefined,
) {
  assertIssuePublicationTarget(manifest, target);
  const expected = `${target}:${manifest.packId}:${manifestDigest}`;
  if (confirmation !== expected) {
    throw new Error(`Publish confirmation must exactly equal ${expected}.`);
  }
}

export function planIssuePublication(
  database: Database["db"],
  manifest: IssueManifest,
  manifestDigest: string,
) {
  return inspectIssueManifest(database, manifest, manifestDigest);
}

function toIssueInsert(issue: IssueManifestItem) {
  return {
    id: issue.id,
    successorIssueId: null,
    lifecycle: issue.lifecycle,
    visibility: issue.visibility,
    participation: issue.participation,
    resultVisibility: issue.resultVisibility,
    feedEligibility: issue.feedEligibility,
    riskLevel: issue.riskLevel,
    isPolitical: issue.isPolitical,
    voteOpenAt: new Date(issue.voteOpenAt),
    voteCloseAt: null,
  };
}

export async function publishIssueManifest(
  database: Database["db"],
  manifest: IssueManifest,
  manifestDigest: string,
): Promise<IssuePublicationResult> {
  return database.transaction(
    async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('which:issue-publication', 0))`,
      );

      const plan = await inspectIssueManifest(transaction, manifest, manifestDigest);
      if (plan.summary.conflict > 0) throw new IssuePublicationConflictError(plan);

      const createIds = new Set(
        plan.issues.filter((item) => item.action === "CREATE").map((item) => item.issueId),
      );
      const createItems = manifest.issues.filter((issue) => createIds.has(issue.id));

      if (createItems.length > 0) {
        const occurredAt = new Date();
        await transaction.insert(issues).values(createItems.map(toIssueInsert));
        await transaction.insert(issueVersions).values(
          createItems.map((issue) => ({
            issueId: issue.id,
            version: issue.version,
            question: issue.question,
            context: issue.context,
            contentHash: issue.contentHash,
            primaryCategoryCode: issue.primaryCategoryCode,
            experienceModeCode: issue.experienceModeCode,
            taxonomyVersion: issue.taxonomyVersion,
            publishedAt: new Date(issue.publishedAt),
          })),
        );
        await transaction.insert(issueChoices).values(
          createItems.flatMap((issue) =>
            issue.choices.map((choice) => ({
              id: choice.id,
              issueId: issue.id,
              issueVersion: issue.version,
              code: choice.code,
              label: choice.label,
            })),
          ),
        );
        await transaction.insert(issueInterestCards).values(
          createItems.flatMap((issue) =>
            issue.interestCardCodes.map((cardCode) => ({
              issueId: issue.id,
              issueVersion: issue.version,
              cardCode,
              taxonomyVersion: "interest_cards_v1",
              weight: 100,
            })),
          ),
        );
        await transaction.insert(voteAggregates).values(
          createItems.map((issue) => ({
            issueId: issue.id,
            issueVersion: issue.version,
            resultVersion: 1,
            voteRequestCount: 0,
            acceptedACount: 0,
            acceptedBCount: 0,
            acceptedVoteCount: 0,
            reviewVoteCount: 0,
            rejectedDuplicateCount: 0,
            rejectedAbuseCount: 0,
            invalidatedVoteCount: 0,
            displayedVoteCount: 0,
            integrityState: "NORMAL" as const,
          })),
        );
        await transaction.insert(resultSnapshots).values(
          createItems.map((issue) => ({
            issueId: issue.id,
            issueVersion: issue.version,
            resultVersion: 1,
            acceptedACount: 0,
            acceptedBCount: 0,
            displayedVoteCount: 0,
            integrityState: "NORMAL" as const,
          })),
        );
        await transaction.insert(outboxEvents).values(
          createItems.map((issue) => {
            const eventId = randomUUID();
            const aggregateId = `${issue.id}:${issue.version}`;
            return {
              id: eventId,
              aggregateType: "ISSUE_VERSION",
              aggregateId,
              eventType: "ISSUE_PUBLISHED",
              schemaVersion: 1,
              occurredAt,
              payload: {
                event_id: eventId,
                event_type: "ISSUE_PUBLISHED",
                schema_version: 1,
                occurred_at: occurredAt.toISOString(),
                aggregate_type: "ISSUE_VERSION",
                aggregate_id: aggregateId,
                data: {
                  issue_id: issue.id,
                  issue_version: issue.version,
                  pack_id: manifest.packId,
                  manifest_digest: manifestDigest,
                  content_hash: issue.contentHash,
                },
              },
            };
          }),
        );
      }

      const verification = await inspectIssueManifest(transaction, manifest, manifestDigest);
      if (verification.summary.conflict > 0 || verification.summary.create > 0) {
        throw new IssuePublicationConflictError(verification);
      }

      return {
        schemaVersion: 1,
        packId: manifest.packId,
        manifestDigest,
        target: manifest.target,
        created: createItems.length,
        alreadyPresent: plan.summary.noOp,
        verification,
      };
    },
    { isolationLevel: "serializable" },
  );
}
