import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { INTEREST_CARD_CODES } from "../interests/contracts.js";

import {
  computeIssueContentHash,
  computeIssueSemanticFingerprint,
  computeManifestDigest,
} from "./content-hash.js";

const normalizedText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim(), "Text must not have leading or trailing whitespace.")
    .refine(
      (value) => value === value.normalize("NFC"),
      "Text must use Unicode NFC normalization.",
    );

const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest.");

const choiceSchema = z
  .object({
    id: z.string().uuid(),
    code: z.enum(["A", "B"]),
    label: normalizedText(1, 100),
  })
  .strict();

const editorialReviewSchema = z
  .object({
    status: z.literal("PASSED"),
    reviewedBy: normalizedText(1, 100),
    reviewedAt: timestamp,
    evergreen: z.boolean(),
    sourceRequirement: z.enum(["NOT_REQUIRED_SUBJECTIVE", "SOURCE_REQUIRED"]),
    sourceUrls: z.array(z.string().url()).max(5),
    choiceParity: z.literal("PASSED"),
    duplicateReview: z.literal("PASSED"),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.sourceRequirement === "SOURCE_REQUIRED" && review.sourceUrls.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrls"],
        message: "Source-required editorial reviews must include at least one source URL.",
      });
    }
    if (review.sourceRequirement === "NOT_REQUIRED_SUBJECTIVE" && review.sourceUrls.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrls"],
        message: "Subjective evergreen reviews must not attach unused source URLs.",
      });
    }
  });

const issueSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    question: normalizedText(1, 200),
    context: normalizedText(1, 500),
    choices: z.tuple([choiceSchema, choiceSchema]),
    primaryCategoryCode: normalizedText(1, 64),
    interestCardCodes: z
      .array(z.enum(INTEREST_CARD_CODES))
      .min(1)
      .max(3)
      .refine((codes) => new Set(codes).size === codes.length, "Interest cards must be unique."),
    experienceModeCode: normalizedText(1, 64),
    taxonomyVersion: normalizedText(1, 32),
    riskLevel: z.literal("LOW"),
    isPolitical: z.literal(false),
    lifecycle: z.literal("PUBLISHED"),
    visibility: z.literal("VISIBLE"),
    participation: z.literal("VOTING_OPEN"),
    resultVisibility: z.literal("PRE_VOTE_HIDDEN"),
    feedEligibility: z.literal("ELIGIBLE"),
    publishedAt: timestamp,
    voteOpenAt: timestamp,
    contentHash: sha256,
    editorialReview: editorialReviewSchema.optional(),
  })
  .strict()
  .superRefine((issue, context) => {
    if (issue.choices[0].code !== "A" || issue.choices[1].code !== "B") {
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Choices must be ordered as exactly one A followed by exactly one B.",
      });
    }

    const computedHash = computeIssueContentHash(issue);
    if (issue.contentHash !== computedHash) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: `Content hash does not match the approved Issue contract; expected ${computedHash}.`,
      });
    }
  });

export const issuePublicationTargetSchema = z.enum(["development", "staging", "production"]);

export const issueManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(96),
    target: issuePublicationTargetSchema,
    taxonomyVersion: normalizedText(1, 32),
    approval: z
      .object({
        status: z.literal("APPROVED"),
        approvedBy: normalizedText(1, 100),
        approvedAt: timestamp,
      })
      .strict(),
    issues: z.array(issueSchema).min(1).max(100),
  })
  .strict()
  .superRefine((manifest, context) => {
    const domainIds = new Map<string, string>();
    const issueVersions = new Map<string, number>();
    const semanticFingerprints = new Map<string, number>();

    function registerDomainId(id: string, path: string) {
      const previous = domainIds.get(id);
      if (previous) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: `Domain ID duplicates ${previous}.`,
        });
      } else {
        domainIds.set(id, path);
      }
    }

    manifest.issues.forEach((issue, issueIndex) => {
      if (issue.taxonomyVersion !== manifest.taxonomyVersion) {
        context.addIssue({
          code: "custom",
          path: ["issues", issueIndex, "taxonomyVersion"],
          message: "Issue taxonomyVersion must match the Pack taxonomyVersion.",
        });
      }

      const versionKey = `${issue.id}:${issue.version}`;
      const previousVersionIndex = issueVersions.get(versionKey);
      if (previousVersionIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["issues", issueIndex],
          message: `Issue Version duplicates issues.${previousVersionIndex}.`,
        });
      } else {
        issueVersions.set(versionKey, issueIndex);
      }

      registerDomainId(issue.id, `issues.${issueIndex}.id`);
      issue.choices.forEach((choice, choiceIndex) =>
        registerDomainId(choice.id, `issues.${issueIndex}.choices.${choiceIndex}.id`),
      );

      const semanticFingerprint = computeIssueSemanticFingerprint(issue);
      const previousSemanticIndex = semanticFingerprints.get(semanticFingerprint);
      if (previousSemanticIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["issues", issueIndex],
          message: `Issue wording duplicates issues.${previousSemanticIndex}.`,
        });
      } else {
        semanticFingerprints.set(semanticFingerprint, issueIndex);
      }
    });
  });

export type IssueManifest = z.infer<typeof issueManifestSchema>;
export type IssueManifestItem = IssueManifest["issues"][number];
export type IssuePublicationTarget = z.infer<typeof issuePublicationTargetSchema>;

export function parseIssueManifest(value: unknown) {
  return issueManifestSchema.parse(value);
}

export async function loadIssueManifest(path: string) {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath);
  return {
    path: absolutePath,
    manifestDigest: computeManifestDigest(source),
    manifest: parseIssueManifest(JSON.parse(source.toString("utf8")) as unknown),
  };
}
