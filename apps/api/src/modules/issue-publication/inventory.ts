import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { INTEREST_CARD_CODES } from "../interests/contracts.js";

import { computeIssueSemanticFingerprint } from "./content-hash.js";
import { loadIssueManifest, type IssueManifest } from "./manifest.js";

const positiveInteger = z.number().int().positive();

export const issueInventoryPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    activeManifestPaths: z.array(z.string().min(1)).min(1),
    reserveManifestPaths: z.array(z.string().min(1)).min(1),
    grandfatheredPackIds: z.array(z.string()).default([]),
    targets: z
      .object({
        activePoolMinimum: positiveInteger,
        approvedReserveMinimum: positiveInteger,
        dailyPublicationTarget: positiveInteger,
        minimumActiveDaysOfSupply: positiveInteger,
        minimumReserveDaysOfSupply: positiveInteger,
        requiredCategoryCodes: z.array(z.string().min(1)).min(1),
        minimumActivePerCategory: positiveInteger,
        minimumActivePerInterestCard: positiveInteger,
        betaSessionsPerUser: positiveInteger,
        issuesPerSession: positiveInteger,
        minimumUnseenBuffer: z.number().int().nonnegative(),
        exhaustionFallback: z.literal("STOP_WITH_EMPTY_STATE"),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    const paths = [...policy.activeManifestPaths, ...policy.reserveManifestPaths];
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        path: ["activeManifestPaths"],
        message: "Active and reserve manifest paths must be unique.",
      });
    }
  });

export type IssueInventoryPolicy = z.infer<typeof issueInventoryPolicySchema>;

type InventoryViolation = {
  code: string;
  message: string;
};

export type IssueInventoryReadinessReport = {
  schemaVersion: 1;
  policyId: string;
  ready: boolean;
  summary: {
    activeIssues: number;
    approvedReserveIssues: number;
    dailyPublicationTarget: number;
    activeDaysOfSupply: number;
    reserveDaysOfSupply: number;
  };
  coverage: {
    activeByCategory: Record<string, number>;
    activeByInterestCard: Record<string, number>;
  };
  exhaustionDryRun: {
    sessionsPerUser: number;
    issuesPerSession: number;
    requiredUniqueIssues: number;
    unseenActiveBuffer: number;
    fallback: "STOP_WITH_EMPTY_STATE";
    passed: boolean;
  };
  reserveCalendar: Array<{
    packId: string;
    issueCount: number;
    publishAt: string;
  }>;
  violations: InventoryViolation[];
};

function increment(target: Record<string, number>, code: string) {
  target[code] = (target[code] ?? 0) + 1;
}

function validateEditorialQuality(
  manifests: IssueManifest[],
  grandfatheredPackIds: Set<string>,
  violations: InventoryViolation[],
) {
  for (const manifest of manifests) {
    for (const issue of manifest.issues) {
      if (!grandfatheredPackIds.has(manifest.packId) && !issue.editorialReview) {
        violations.push({
          code: "EDITORIAL_REVIEW_MISSING",
          message: `${manifest.packId}:${issue.id} has no passed editorial review.`,
        });
      }
      if (!issue.question.endsWith("?")) {
        violations.push({
          code: "QUESTION_FORMAT",
          message: `${manifest.packId}:${issue.id} must end with a question mark.`,
        });
      }
      const [choiceA, choiceB] = issue.choices;
      if (choiceA.label.toLocaleLowerCase("ko") === choiceB.label.toLocaleLowerCase("ko")) {
        violations.push({
          code: "CHOICE_DUPLICATE",
          message: `${manifest.packId}:${issue.id} has identical A/B labels.`,
        });
      }
      const shorter = Math.min(choiceA.label.length, choiceB.label.length);
      const longer = Math.max(choiceA.label.length, choiceB.label.length);
      if (longer / shorter > 3 || longer - shorter > 24) {
        violations.push({
          code: "CHOICE_PARITY_HEURISTIC",
          message: `${manifest.packId}:${issue.id} failed the automated A/B length parity check.`,
        });
      }
    }
  }
}

function validateCrossPackUniqueness(manifests: IssueManifest[], violations: InventoryViolation[]) {
  const domainIds = new Map<string, string>();
  const semantics = new Map<string, string>();
  for (const manifest of manifests) {
    for (const issue of manifest.issues) {
      const location = `${manifest.packId}:${issue.id}`;
      for (const id of [issue.id, ...issue.choices.map((choice) => choice.id)]) {
        const previous = domainIds.get(id);
        if (previous) {
          violations.push({
            code: "CROSS_PACK_ID_DUPLICATE",
            message: `${location} reuses a domain ID from ${previous}.`,
          });
        } else {
          domainIds.set(id, location);
        }
      }
      const fingerprint = computeIssueSemanticFingerprint(issue);
      const previous = semantics.get(fingerprint);
      if (previous) {
        violations.push({
          code: "CROSS_PACK_WORDING_DUPLICATE",
          message: `${location} duplicates the approved wording in ${previous}.`,
        });
      } else {
        semantics.set(fingerprint, location);
      }
    }
  }
}

export function evaluateIssueInventory(
  policy: IssueInventoryPolicy,
  activeManifests: IssueManifest[],
  reserveManifests: IssueManifest[],
): IssueInventoryReadinessReport {
  const violations: InventoryViolation[] = [];
  const allManifests = [...activeManifests, ...reserveManifests];
  const activeIssues = activeManifests.flatMap((manifest) => manifest.issues);
  const reserveIssues = reserveManifests.flatMap((manifest) => manifest.issues);
  const activeByCategory: Record<string, number> = {};
  const activeByInterestCard: Record<string, number> = {};

  for (const issue of activeIssues) {
    increment(activeByCategory, issue.primaryCategoryCode);
    for (const cardCode of issue.interestCardCodes) increment(activeByInterestCard, cardCode);
  }

  validateEditorialQuality(allManifests, new Set(policy.grandfatheredPackIds), violations);
  validateCrossPackUniqueness(allManifests, violations);

  for (const manifest of allManifests) {
    if (manifest.target !== "production") {
      violations.push({
        code: "NON_PRODUCTION_PACK",
        message: `${manifest.packId} targets ${manifest.target}, not production.`,
      });
    }
  }

  if (activeIssues.length < policy.targets.activePoolMinimum) {
    violations.push({
      code: "ACTIVE_POOL_BELOW_TARGET",
      message: `Active pool has ${activeIssues.length}; target is ${policy.targets.activePoolMinimum}.`,
    });
  }
  if (reserveIssues.length < policy.targets.approvedReserveMinimum) {
    violations.push({
      code: "RESERVE_BELOW_TARGET",
      message: `Approved reserve has ${reserveIssues.length}; target is ${policy.targets.approvedReserveMinimum}.`,
    });
  }

  for (const categoryCode of policy.targets.requiredCategoryCodes) {
    const count = activeByCategory[categoryCode] ?? 0;
    if (count < policy.targets.minimumActivePerCategory) {
      violations.push({
        code: "CATEGORY_BELOW_TARGET",
        message: `${categoryCode} has ${count} active Issues; minimum is ${policy.targets.minimumActivePerCategory}.`,
      });
    }
  }
  for (const cardCode of INTEREST_CARD_CODES) {
    const count = activeByInterestCard[cardCode] ?? 0;
    if (count < policy.targets.minimumActivePerInterestCard) {
      violations.push({
        code: "INTEREST_CARD_BELOW_TARGET",
        message: `${cardCode} has ${count} active Issues; minimum is ${policy.targets.minimumActivePerInterestCard}.`,
      });
    }
  }

  const activeDaysOfSupply = activeIssues.length / policy.targets.dailyPublicationTarget;
  const reserveDaysOfSupply = reserveIssues.length / policy.targets.dailyPublicationTarget;
  if (activeDaysOfSupply < policy.targets.minimumActiveDaysOfSupply) {
    violations.push({
      code: "ACTIVE_DAYS_OF_SUPPLY",
      message: `Active supply is ${activeDaysOfSupply} days; minimum is ${policy.targets.minimumActiveDaysOfSupply}.`,
    });
  }
  if (reserveDaysOfSupply < policy.targets.minimumReserveDaysOfSupply) {
    violations.push({
      code: "RESERVE_DAYS_OF_SUPPLY",
      message: `Reserve supply is ${reserveDaysOfSupply} days; minimum is ${policy.targets.minimumReserveDaysOfSupply}.`,
    });
  }

  const requiredUniqueIssues = policy.targets.betaSessionsPerUser * policy.targets.issuesPerSession;
  const unseenActiveBuffer = activeIssues.length - requiredUniqueIssues;
  const exhaustionPassed = unseenActiveBuffer >= policy.targets.minimumUnseenBuffer;
  if (!exhaustionPassed) {
    violations.push({
      code: "POOL_EXHAUSTION_DRY_RUN",
      message: `Dry Run leaves ${unseenActiveBuffer} unseen active Issues; minimum buffer is ${policy.targets.minimumUnseenBuffer}.`,
    });
  }

  const reserveCalendar = reserveManifests
    .map((manifest) => ({
      packId: manifest.packId,
      issueCount: manifest.issues.length,
      publishAt: manifest.issues
        .map((issue) => issue.publishedAt)
        .sort((left, right) => left.localeCompare(right))[0]!,
    }))
    .sort((left, right) => left.publishAt.localeCompare(right.publishAt));
  for (const entry of reserveCalendar) {
    if (entry.issueCount !== policy.targets.dailyPublicationTarget) {
      violations.push({
        code: "RESERVE_CALENDAR_BATCH_SIZE",
        message: `${entry.packId} has ${entry.issueCount} Issues; daily target is ${policy.targets.dailyPublicationTarget}.`,
      });
    }
  }

  return {
    schemaVersion: 1,
    policyId: policy.policyId,
    ready: violations.length === 0,
    summary: {
      activeIssues: activeIssues.length,
      approvedReserveIssues: reserveIssues.length,
      dailyPublicationTarget: policy.targets.dailyPublicationTarget,
      activeDaysOfSupply,
      reserveDaysOfSupply,
    },
    coverage: { activeByCategory, activeByInterestCard },
    exhaustionDryRun: {
      sessionsPerUser: policy.targets.betaSessionsPerUser,
      issuesPerSession: policy.targets.issuesPerSession,
      requiredUniqueIssues,
      unseenActiveBuffer,
      fallback: policy.targets.exhaustionFallback,
      passed: exhaustionPassed,
    },
    reserveCalendar,
    violations,
  };
}

export async function loadIssueInventoryReadiness(policyPath: string) {
  const absolutePolicyPath = resolve(policyPath);
  const policy = issueInventoryPolicySchema.parse(
    JSON.parse(await readFile(absolutePolicyPath, "utf8")) as unknown,
  );
  const policyDirectory = dirname(absolutePolicyPath);
  const loadAll = (paths: string[]) =>
    Promise.all(paths.map((path) => loadIssueManifest(resolve(policyDirectory, path))));
  const [active, reserve] = await Promise.all([
    loadAll(policy.activeManifestPaths),
    loadAll(policy.reserveManifestPaths),
  ]);
  return evaluateIssueInventory(
    policy,
    active.map((loaded) => loaded.manifest),
    reserve.map((loaded) => loaded.manifest),
  );
}
