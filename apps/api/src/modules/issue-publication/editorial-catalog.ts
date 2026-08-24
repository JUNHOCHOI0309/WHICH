import { z } from "zod";

import { INTEREST_CARD_CODES } from "../interests/contracts.js";

import { computeIssueContentHash, computeIssueSemanticFingerprint } from "./content-hash.js";
import { parseIssueManifest, type IssueManifest, type IssueManifestItem } from "./manifest.js";

const normalizedText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim(), "Text must not have surrounding whitespace.")
    .refine((value) => value === value.normalize("NFC"), "Text must use Unicode NFC.");

const timestamp = z.string().datetime({ offset: true });
const dateOnly = z.string().date();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const pendingCatalogApprovalSchema = z
  .object({
    status: z.literal("PENDING_HUMAN_EDITORIAL_APPROVAL"),
    humanApprovalRequired: z.literal(true),
    automatedValidation: z.string().optional(),
    approvedBy: z.null(),
    approvedAt: z.null(),
  })
  .passthrough();

const approvedCatalogApprovalSchema = z
  .object({
    status: z.literal("HUMAN_APPROVED"),
    humanApprovalRequired: z.literal(false),
    automatedValidation: z.literal("PASSED"),
    approvedBy: normalizedText(1, 100),
    approvedAt: timestamp,
  })
  .strict();

const pendingEditorialReviewSchema = z
  .object({
    status: z.string().refine((value) => value !== "HUMAN_APPROVED"),
    humanApproval: z.string().refine((value) => value !== "APPROVED"),
    binaryFit: z.string(),
    choiceParity: z.string(),
    duplicateReview: z.string(),
    sourceReview: z.string(),
  })
  .passthrough();

const approvedEditorialReviewSchema = z
  .object({
    status: z.literal("HUMAN_APPROVED"),
    humanApproval: z.literal("APPROVED"),
    reviewedBy: normalizedText(1, 100),
    reviewedAt: timestamp,
    binaryFit: z.literal("PASSED"),
    choiceParity: z.literal("PASSED"),
    duplicateReview: z.literal("PASSED"),
    sourceReview: z.literal("PASSED"),
  })
  .strict();

const sourceProfileSchema = z
  .object({
    discoveryLead: z.enum(["EDITORIAL", "COMMUNITY", "OFFICIAL"]),
    sourceRequirement: z.enum([
      "NOT_REQUIRED_SUBJECTIVE",
      "DISCOVERY_SIGNAL_ONLY",
      "SOURCE_REQUIRED",
    ]),
    communitySignalIds: z.array(normalizedText(1, 120)),
    communitySignalRole: normalizedText(1, 120),
    factSourceIds: z.array(normalizedText(1, 120)).max(5),
    asOf: dateOnly.nullable(),
    reviewAfter: dateOnly.nullable(),
    expiresAt: dateOnly.nullable(),
    evergreen: z.boolean(),
    sourceFitReview: normalizedText(1, 120),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.sourceRequirement === "SOURCE_REQUIRED") {
      if (profile.factSourceIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["factSourceIds"],
          message: "Source-required candidates need at least one fact source.",
        });
      }
      for (const field of ["asOf", "reviewAfter", "expiresAt"] as const) {
        if (!profile[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `Source-required candidates need ${field}.`,
          });
        }
      }
      if (profile.evergreen) {
        context.addIssue({
          code: "custom",
          path: ["evergreen"],
          message: "Source-required candidates cannot be evergreen.",
        });
      }
    } else if (profile.sourceRequirement === "DISCOVERY_SIGNAL_ONLY") {
      if (profile.communitySignalIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["communitySignalIds"],
          message: "Discovery-only candidates need at least one community signal.",
        });
      }
      if (profile.factSourceIds.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["factSourceIds"],
          message: "Discovery signals must not be treated as fact sources.",
        });
      }
    } else {
      if (profile.factSourceIds.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["factSourceIds"],
          message: "Subjective candidates must not retain unused fact sources.",
        });
      }
      if (profile.evergreen && (profile.asOf || profile.reviewAfter || profile.expiresAt)) {
        context.addIssue({
          code: "custom",
          path: ["asOf"],
          message: "Evergreen subjective candidates must not retain review dates.",
        });
      }
    }
  });

const editorialChoiceSchema = z
  .object({
    id: z.string().uuid(),
    code: z.enum(["A", "B"]),
    label: normalizedText(1, 100),
  })
  .strict();

export const expandedEditorialIssueSchema = z
  .object({
    candidateId: z.string().regex(/^WEXP-[0-9]{4}$/),
    id: z.string().uuid(),
    version: z.number().int().positive(),
    question: normalizedText(1, 200),
    context: normalizedText(1, 500),
    choices: z.tuple([editorialChoiceSchema, editorialChoiceSchema]),
    primaryCategoryCode: normalizedText(1, 64),
    interestCardCodes: z
      .array(z.enum(INTEREST_CARD_CODES))
      .min(1)
      .max(3)
      .refine((codes) => new Set(codes).size === codes.length),
    experienceModeCode: normalizedText(1, 64),
    taxonomyVersion: normalizedText(1, 32),
    riskLevel: z.enum(["LOW", "MEDIUM"]),
    isPolitical: z.literal(false),
    sourceProfile: sourceProfileSchema,
    contentHash: sha256,
    editorialReview: z.union([pendingEditorialReviewSchema, approvedEditorialReviewSchema]),
  })
  .passthrough()
  .superRefine((issue, context) => {
    if (issue.choices[0].code !== "A" || issue.choices[1].code !== "B") {
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Choices must be ordered A then B.",
      });
    }
    const expectedHash = computeIssueContentHash(issue);
    if (issue.contentHash !== expectedHash) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: `Candidate content hash mismatch; expected ${expectedHash}.`,
      });
    }
  });

export const expandedEditorialCatalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    catalogId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    taxonomyVersion: normalizedText(1, 32),
    approval: z.union([pendingCatalogApprovalSchema, approvedCatalogApprovalSchema]),
    issues: z.array(expandedEditorialIssueSchema).min(1).max(1000),
  })
  .passthrough()
  .superRefine((catalog, context) => {
    const candidateIds = new Set<string>();
    const domainIds = new Set<string>();
    const semantics = new Map<string, number>();
    catalog.issues.forEach((issue, index) => {
      if (issue.taxonomyVersion !== catalog.taxonomyVersion) {
        context.addIssue({
          code: "custom",
          path: ["issues", index, "taxonomyVersion"],
          message: "Candidate taxonomyVersion must match its catalog.",
        });
      }
      if (candidateIds.has(issue.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["issues", index, "candidateId"],
          message: "Candidate ID is duplicated.",
        });
      }
      candidateIds.add(issue.candidateId);
      for (const id of [issue.id, ...issue.choices.map((choice) => choice.id)]) {
        if (domainIds.has(id)) {
          context.addIssue({
            code: "custom",
            path: ["issues", index],
            message: `Domain ID ${id} is duplicated.`,
          });
        }
        domainIds.add(id);
      }
      const fingerprint = computeIssueSemanticFingerprint(issue);
      const previous = semantics.get(fingerprint);
      if (previous !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["issues", index],
          message: `Candidate wording duplicates issues.${previous}.`,
        });
      }
      semantics.set(fingerprint, index);
    });
  });

export const factSourceRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    asOf: dateOnly,
    sources: z
      .array(
        z
          .object({
            id: normalizedText(1, 120),
            publisher: normalizedText(1, 120),
            title: normalizedText(1, 300),
            url: z.string().url(),
            publishedAt: dateOnly,
            topics: z.array(normalizedText(1, 120)).min(1),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()
  .superRefine((registry, context) => {
    const ids = registry.sources.map((source) => source.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Source IDs must be unique.",
      });
    }
  });

export const expandedPublicationPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    target: z.literal("production"),
    approval: z
      .object({
        status: z.literal("APPROVED"),
        approvedBy: normalizedText(1, 100),
        approvedAt: timestamp,
      })
      .strict(),
    packs: z
      .array(
        z
          .object({
            fileName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/),
            packId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            publicationAt: timestamp,
            candidateIds: z
              .array(z.string().regex(/^WEXP-[0-9]{4}$/))
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = plan.packs.flatMap((pack) => pack.candidateIds);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["packs"],
        message: "A candidate can appear in only one publication pack.",
      });
    }
  });

export type ExpandedEditorialCatalog = z.infer<typeof expandedEditorialCatalogSchema>;
export type FactSourceRegistry = z.infer<typeof factSourceRegistrySchema>;
export type ExpandedPublicationPlan = z.infer<typeof expandedPublicationPlanSchema>;

function requirePublicationApproval(issue: ExpandedEditorialCatalog["issues"][number]) {
  if (issue.editorialReview.status !== "HUMAN_APPROVED") {
    throw new Error(`${issue.candidateId} is still pending human editorial approval.`);
  }
  if (issue.riskLevel !== "LOW") {
    throw new Error(
      `${issue.candidateId} is ${issue.riskLevel} and needs the separate risk approval route.`,
    );
  }
  if (issue.sourceProfile.sourceFitReview !== "PASSED") {
    throw new Error(`${issue.candidateId} has not passed source-fit review.`);
  }
}

function assertCurrentSourceReview(
  issue: ExpandedEditorialCatalog["issues"][number],
  sourceById: Map<string, FactSourceRegistry["sources"][number]>,
  today: string,
) {
  const profile = issue.sourceProfile;
  for (const sourceId of profile.factSourceIds) {
    if (!sourceById.has(sourceId)) {
      throw new Error(`${issue.candidateId} references unknown fact source ${sourceId}.`);
    }
  }
  if (profile.sourceRequirement === "SOURCE_REQUIRED") {
    if (profile.reviewAfter! <= today) {
      throw new Error(
        `${issue.candidateId} passed reviewAfter ${profile.reviewAfter}; re-review is required.`,
      );
    }
    if (profile.expiresAt! <= today) {
      throw new Error(`${issue.candidateId} expired on ${profile.expiresAt}.`);
    }
  }
}

export function buildExpandedIssuePacks(
  catalogValue: unknown,
  registryValue: unknown,
  planValue: unknown,
  options: { now?: Date; comparisonIssues?: IssueManifestItem[] } = {},
) {
  const catalog = expandedEditorialCatalogSchema.parse(catalogValue);
  const registry = factSourceRegistrySchema.parse(registryValue);
  const plan = expandedPublicationPlanSchema.parse(planValue);
  if (catalog.approval.status !== "HUMAN_APPROVED") {
    throw new Error("Expanded catalog is not human-approved.");
  }
  if (plan.catalogId !== catalog.catalogId) {
    throw new Error(`Publication plan targets ${plan.catalogId}, not ${catalog.catalogId}.`);
  }

  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const issueByCandidateId = new Map(catalog.issues.map((issue) => [issue.candidateId, issue]));
  const sourceById = new Map(registry.sources.map((source) => [source.id, source]));
  const approvedSemantics = new Map<string, string>();
  for (const issue of options.comparisonIssues ?? []) {
    approvedSemantics.set(computeIssueSemanticFingerprint(issue), `approved Issue ${issue.id}`);
  }

  return plan.packs.map((pack) => {
    const issues = pack.candidateIds.map((candidateId) => {
      const candidate = issueByCandidateId.get(candidateId);
      if (!candidate)
        throw new Error(`Publication plan references unknown candidate ${candidateId}.`);
      requirePublicationApproval(candidate);
      assertCurrentSourceReview(candidate, sourceById, today);
      const fingerprint = computeIssueSemanticFingerprint(candidate);
      const previous = approvedSemantics.get(fingerprint);
      if (previous) throw new Error(`${candidateId} duplicates ${previous}.`);
      approvedSemantics.set(fingerprint, candidateId);

      const sourceUrls = candidate.sourceProfile.factSourceIds.map(
        (sourceId) => sourceById.get(sourceId)!.url,
      );
      return {
        id: candidate.id,
        version: candidate.version,
        question: candidate.question,
        context: candidate.context,
        choices: candidate.choices,
        primaryCategoryCode: candidate.primaryCategoryCode,
        interestCardCodes: candidate.interestCardCodes,
        experienceModeCode: candidate.experienceModeCode,
        taxonomyVersion: catalog.taxonomyVersion,
        riskLevel: "LOW" as const,
        isPolitical: false as const,
        lifecycle: "PUBLISHED" as const,
        visibility: "VISIBLE" as const,
        participation: "VOTING_OPEN" as const,
        resultVisibility: "PRE_VOTE_HIDDEN" as const,
        feedEligibility: "ELIGIBLE" as const,
        publishedAt: pack.publicationAt,
        voteOpenAt: pack.publicationAt,
        contentHash: candidate.contentHash,
        editorialReview: {
          status: "PASSED" as const,
          reviewedBy: candidate.editorialReview.reviewedBy,
          reviewedAt: candidate.editorialReview.reviewedAt,
          evergreen: candidate.sourceProfile.evergreen,
          sourceRequirement: candidate.sourceProfile.sourceRequirement,
          sourceUrls,
          choiceParity: "PASSED" as const,
          duplicateReview: "PASSED" as const,
        },
      };
    });
    return {
      fileName: pack.fileName,
      manifest: parseIssueManifest({
        schemaVersion: 1,
        packId: pack.packId,
        target: plan.target,
        taxonomyVersion: catalog.taxonomyVersion,
        approval: plan.approval,
        issues,
      }),
    };
  });
}

export function collectComparisonIssues(manifests: IssueManifest[]) {
  return manifests.flatMap((manifest) => manifest.issues);
}
