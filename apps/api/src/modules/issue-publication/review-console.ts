import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  expandedEditorialCatalogSchema,
  expandedPublicationPlanSchema,
  factSourceRegistrySchema,
  type ExpandedEditorialCatalog,
} from "./editorial-catalog.js";

export type InventoryScope = "ACTIVE" | "RESERVE" | "LONG_TERM";

const inventorySchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogId: z.string(),
    activePoolCandidateIds: z.array(z.string()),
    approvedReserveCandidateIds: z.array(z.string()),
    longTermCandidateIds: z.array(z.string()),
  })
  .passthrough();

const sourceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
  })
  .passthrough();

const communityRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.array(sourceSchema),
  })
  .passthrough();

const checksSchema = z
  .object({
    binaryFit: z.boolean(),
    choiceParity: z.boolean(),
    duplicateReview: z.boolean(),
    sourceReview: z.boolean(),
  })
  .strict();

export const decisionInputSchema = z
  .object({
    status: z.enum(["APPROVED", "NEEDS_CHANGES", "REJECTED"]),
    note: z.string().trim().max(2000),
    reviewedBy: z.string().trim().min(1).max(100),
    checks: checksSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.status === "APPROVED" && Object.values(decision.checks).some((value) => !value)) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "승인하려면 네 가지 편집 검수 항목을 모두 확인해야 합니다.",
      });
    }
  });

export const storedDecisionSchema = decisionInputSchema.extend({
  candidateId: z.string().regex(/^WEXP-[0-9]{4}$/),
  reviewedAt: z.string().datetime({ offset: true }),
});

export const decisionStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogId: z.string(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
    decisions: z.array(storedDecisionSchema),
  })
  .strict();

export const exportInputSchema = z
  .object({
    scope: z.enum(["ACTIVE", "RESERVE", "LONG_TERM", "ALL"]),
    startAt: z.string().datetime({ offset: true }),
    dailyTarget: z.number().int().min(1).max(100).default(6),
    reviewedBy: z.string().trim().min(1).max(100),
    overwrite: z.boolean().default(false),
  })
  .strict();

export type ReviewDecisionInput = z.infer<typeof decisionInputSchema>;
export type StoredDecision = z.infer<typeof storedDecisionSchema>;
export type DecisionStore = z.infer<typeof decisionStoreSchema>;
type Inventory = z.infer<typeof inventorySchema>;

export type ReviewConsolePaths = {
  catalog: string;
  inventory: string;
  factSources: string;
  communitySources: string;
  decisions: string;
  outputDirectory: string;
};

type ReviewConsoleDocuments = {
  catalog: ExpandedEditorialCatalog;
  inventory: Inventory;
  factSources: z.infer<typeof factSourceRegistrySchema>;
  communitySources: z.infer<typeof communityRegistrySchema>;
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function atomicWriteJson(path: string, value: unknown, overwrite = true) {
  await mkdir(dirname(path), { recursive: true });
  if (!overwrite) {
    try {
      await readFile(path, "utf8");
      throw new Error(`${path} already exists. Confirm overwrite to replace the draft.`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // The output does not exist yet.
      } else {
        throw error;
      }
    }
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function assertDraftOutputAvailable(path: string) {
  try {
    await readFile(path, "utf8");
    throw new Error(`${path} already exists. Confirm overwrite to replace the draft.`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

function scopeIds(inventory: Inventory, scope: InventoryScope | "ALL") {
  if (scope === "ACTIVE") return inventory.activePoolCandidateIds;
  if (scope === "RESERVE") return inventory.approvedReserveCandidateIds;
  if (scope === "LONG_TERM") return inventory.longTermCandidateIds;
  return [
    ...inventory.activePoolCandidateIds,
    ...inventory.approvedReserveCandidateIds,
    ...inventory.longTermCandidateIds,
  ];
}

function scopeForCandidate(inventory: Inventory, candidateId: string): InventoryScope {
  if (inventory.activePoolCandidateIds.includes(candidateId)) return "ACTIVE";
  if (inventory.approvedReserveCandidateIds.includes(candidateId)) return "RESERVE";
  return "LONG_TERM";
}

function outputNames(scope: "ACTIVE" | "RESERVE" | "LONG_TERM" | "ALL") {
  const label = scope.toLowerCase().replace("_", "-");
  return {
    catalogId: `which-expanded-${label}-approved-v1`,
    catalogFile: `which-expanded-${label}-approved-v1.json`,
    planFile: `which-expanded-${label}-publication-plan-v1.json`,
    packPrefix: `which-expanded-${label}`,
  };
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export class EditorialReviewConsole {
  private readonly decisions = new Map<string, StoredDecision>();
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly paths: ReviewConsolePaths,
    private readonly documents: ReviewConsoleDocuments,
  ) {}

  static async load(paths: ReviewConsolePaths) {
    const [catalogValue, inventoryValue, factValue, communityValue] = await Promise.all([
      readJson(paths.catalog),
      readJson(paths.inventory),
      readJson(paths.factSources),
      readJson(paths.communitySources),
    ]);
    const documents: ReviewConsoleDocuments = {
      catalog: expandedEditorialCatalogSchema.parse(catalogValue),
      inventory: inventorySchema.parse(inventoryValue),
      factSources: factSourceRegistrySchema.parse(factValue),
      communitySources: communityRegistrySchema.parse(communityValue),
    };
    if (documents.inventory.catalogId !== documents.catalog.catalogId) {
      throw new Error("Inventory and catalog IDs do not match.");
    }
    const console = new EditorialReviewConsole(paths, documents);
    try {
      const store = decisionStoreSchema.parse(await readJson(paths.decisions));
      if (store.catalogId !== documents.catalog.catalogId) {
        throw new Error("Decision store and catalog IDs do not match.");
      }
      for (const decision of store.decisions) console.decisions.set(decision.candidateId, decision);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return console;
  }

  getState() {
    const factSourceById = new Map(
      this.documents.factSources.sources.map((source) => [source.id, source]),
    );
    const communitySourceById = new Map(
      this.documents.communitySources.sources.map((source) => [source.id, source]),
    );
    const candidates = this.documents.catalog.issues.map((issue) => ({
      id: issue.id,
      version: issue.version,
      candidateId: issue.candidateId,
      question: issue.question,
      context: issue.context,
      choices: issue.choices,
      category: issue.primaryCategoryCode,
      interestCardCodes: issue.interestCardCodes,
      experienceModeCode: issue.experienceModeCode,
      taxonomyVersion: issue.taxonomyVersion,
      editorialArea: issue.editorialArea,
      riskLevel: issue.riskLevel,
      isPolitical: issue.isPolitical,
      contentHash: issue.contentHash,
      inventoryScope: scopeForCandidate(this.documents.inventory, issue.candidateId),
      sourceProfile: issue.sourceProfile,
      sources: [
        ...issue.sourceProfile.factSourceIds.map((id) => ({
          id,
          kind: "FACT" as const,
          ...factSourceById.get(id),
        })),
        ...issue.sourceProfile.communitySignalIds.map((id) => ({
          id,
          kind: "COMMUNITY" as const,
          ...communitySourceById.get(id),
        })),
      ],
      automatedReview: issue.editorialReview,
      decision: this.decisions.get(issue.candidateId) ?? null,
    }));
    const counts = { PENDING: 0, APPROVED: 0, NEEDS_CHANGES: 0, REJECTED: 0 };
    for (const candidate of candidates) {
      counts[candidate.decision?.status ?? "PENDING"] += 1;
    }
    return {
      catalog: {
        id: this.documents.catalog.catalogId,
        total: candidates.length,
        approval: this.documents.catalog.approval.status,
      },
      inventory: {
        active: this.documents.inventory.activePoolCandidateIds.length,
        reserve: this.documents.inventory.approvedReserveCandidateIds.length,
        longTerm: this.documents.inventory.longTermCandidateIds.length,
      },
      counts,
      candidates,
    };
  }

  async saveDecision(candidateId: string, value: unknown) {
    if (!this.documents.catalog.issues.some((issue) => issue.candidateId === candidateId)) {
      throw new Error(`Unknown candidate ${candidateId}.`);
    }
    const input = decisionInputSchema.parse(value);
    const decision = storedDecisionSchema.parse({
      ...input,
      candidateId,
      reviewedAt: new Date().toISOString(),
    });
    this.decisions.set(candidateId, decision);
    const persist = async () => {
      const decisions = [...this.decisions.values()].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId),
      );
      await atomicWriteJson(this.paths.decisions, {
        schemaVersion: 1,
        catalogId: this.documents.catalog.catalogId,
        updatedAt: decision.reviewedAt,
        decisions,
      });
    };
    this.saveQueue = this.saveQueue.then(persist, persist);
    await this.saveQueue;
    return decision;
  }

  async exportApproved(value: unknown) {
    const input = exportInputSchema.parse(value);
    const ids = scopeIds(this.documents.inventory, input.scope);
    const approved = ids.flatMap((candidateId) => {
      const issue = this.documents.catalog.issues.find(
        (candidate) => candidate.candidateId === candidateId,
      );
      const decision = this.decisions.get(candidateId);
      if (!issue || !decision || decision.status !== "APPROVED") return [];
      if (issue.riskLevel !== "LOW" || issue.isPolitical) return [];
      return [{ issue, decision }];
    });
    if (approved.length === 0)
      throw new Error("선택한 범위에 내보낼 수 있는 승인된 LOW 후보가 없습니다.");

    const names = outputNames(input.scope);
    const approvedAt = new Date().toISOString();
    const catalog = expandedEditorialCatalogSchema.parse({
      ...this.documents.catalog,
      catalogId: names.catalogId,
      approval: {
        status: "HUMAN_APPROVED",
        humanApprovalRequired: false,
        automatedValidation: "PASSED",
        approvedBy: input.reviewedBy,
        approvedAt,
      },
      issues: approved.map(({ issue, decision }) => ({
        ...issue,
        sourceProfile: { ...issue.sourceProfile, sourceFitReview: "PASSED" },
        editorialReview: {
          status: "HUMAN_APPROVED",
          humanApproval: "APPROVED",
          reviewedBy: decision.reviewedBy,
          reviewedAt: decision.reviewedAt,
          binaryFit: "PASSED",
          choiceParity: "PASSED",
          duplicateReview: "PASSED",
          sourceReview: "PASSED",
        },
        publicationCompatibility: {
          builderVersion: 2,
          builderCompatible: true,
          blockingReasons: [],
          publicationStatus: "READY_FOR_APPROVED_PLAN",
        },
      })),
    });

    const packs = Array.from(
      { length: Math.ceil(approved.length / input.dailyTarget) },
      (_, index) => {
        const day = index + 1;
        return {
          fileName: `${names.packPrefix}-day-${day}-v1.json`,
          packId: `${names.packPrefix}-day-${day}-v1`,
          publicationAt: addDays(input.startAt, index),
          candidateIds: approved
            .slice(index * input.dailyTarget, (index + 1) * input.dailyTarget)
            .map(({ issue }) => issue.candidateId),
        };
      },
    );
    const plan = expandedPublicationPlanSchema.parse({
      schemaVersion: 1,
      catalogId: names.catalogId,
      target: "production",
      approval: { status: "APPROVED", approvedBy: input.reviewedBy, approvedAt },
      packs,
    });
    const catalogPath = join(this.paths.outputDirectory, names.catalogFile);
    const planPath = join(this.paths.outputDirectory, names.planFile);
    if (!input.overwrite) {
      await Promise.all([
        assertDraftOutputAvailable(catalogPath),
        assertDraftOutputAvailable(planPath),
      ]);
    }
    await atomicWriteJson(catalogPath, catalog);
    await atomicWriteJson(planPath, plan);
    return { count: approved.length, catalogPath, planPath, packs: packs.length };
  }
}
