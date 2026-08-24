import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";
import { z } from "zod";

import { INTEREST_CARD_CODES } from "./modules/interests/contracts.js";
import { computeIssueContentHash } from "./modules/issue-publication/content-hash.js";
import {
  buildExpandedIssuePacks,
  collectComparisonIssues,
} from "./modules/issue-publication/editorial-catalog.js";
import { loadIssueManifest } from "./modules/issue-publication/manifest.js";
import { parseIssueManifest } from "./modules/issue-publication/manifest.js";

const normalizedText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim())
    .refine((value) => value === value.normalize("NFC"));

const timestamp = z.string().datetime({ offset: true });

const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    taxonomyVersion: normalizedText(1, 32),
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
            issues: z
              .array(
                z
                  .object({
                    question: normalizedText(1, 200),
                    context: normalizedText(1, 500),
                    choices: z.tuple([normalizedText(1, 100), normalizedText(1, 100)]),
                    primaryCategoryCode: normalizedText(1, 64),
                    interestCardCodes: z
                      .array(z.enum(INTEREST_CARD_CODES))
                      .min(1)
                      .max(3)
                      .refine((codes) => new Set(codes).size === codes.length),
                    experienceModeCode: normalizedText(1, 64).default("PLAYFUL_QUICK"),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const fileNames = catalog.packs.map((pack) => pack.fileName);
    const packIds = catalog.packs.map((pack) => pack.packId);
    if (new Set(fileNames).size !== fileNames.length) {
      context.addIssue({
        code: "custom",
        path: ["packs"],
        message: "Pack filenames must be unique.",
      });
    }
    if (new Set(packIds).size !== packIds.length) {
      context.addIssue({ code: "custom", path: ["packs"], message: "Pack IDs must be unique." });
    }
  });

function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hexadecimal = bytes.toString("hex");
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join("-");
}

export function buildIssuePacks(value: unknown) {
  const catalog = catalogSchema.parse(value);
  return catalog.packs.map((pack) => {
    const issues = pack.issues.map((draft, index) => {
      const issueId = deterministicUuid(`${pack.packId}:issue:${index + 1}:${draft.question}`);
      const choices = (["A", "B"] as const).map((code, choiceIndex) => ({
        id: deterministicUuid(`${issueId}:choice:${code}`),
        code,
        label: draft.choices[choiceIndex],
      })) as [{ id: string; code: "A"; label: string }, { id: string; code: "B"; label: string }];
      const issue = {
        id: issueId,
        version: 1,
        question: draft.question,
        context: draft.context,
        choices,
        primaryCategoryCode: draft.primaryCategoryCode,
        interestCardCodes: draft.interestCardCodes,
        experienceModeCode: draft.experienceModeCode,
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
        contentHash: "",
        editorialReview: {
          status: "PASSED" as const,
          reviewedBy: catalog.approval.approvedBy,
          reviewedAt: catalog.approval.approvedAt,
          evergreen: true,
          sourceRequirement: "NOT_REQUIRED_SUBJECTIVE" as const,
          sourceUrls: [],
          choiceParity: "PASSED" as const,
          duplicateReview: "PASSED" as const,
        },
      };
      issue.contentHash = computeIssueContentHash(issue);
      return issue;
    });
    return {
      fileName: pack.fileName,
      manifest: parseIssueManifest({
        schemaVersion: 1,
        packId: pack.packId,
        target: "production",
        taxonomyVersion: catalog.taxonomyVersion,
        approval: catalog.approval,
        issues,
      }),
    };
  });
}

function usage() {
  return [
    "Usage:",
    "  issue-pack-builder <v1-catalog.json> <output-directory>",
    "  issue-pack-builder <v2-catalog.json> <output-directory> --source-registry <sources.json> --publication-plan <plan.json> [--comparison-manifest <manifest.json>]...",
  ].join("\n");
}

type ExpandedArguments = {
  sourceRegistryPath: string;
  publicationPlanPath: string;
  comparisonManifestPaths: string[];
};

function parseExpandedArguments(values: string[]): ExpandedArguments {
  let sourceRegistryPath: string | undefined;
  let publicationPlanPath: string | undefined;
  const comparisonManifestPaths: string[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag || !value) throw new Error(usage());
    if (flag === "--source-registry") sourceRegistryPath = value;
    else if (flag === "--publication-plan") publicationPlanPath = value;
    else if (flag === "--comparison-manifest") comparisonManifestPaths.push(value);
    else throw new Error(`Unknown option ${flag}.\n${usage()}`);
  }
  if (!sourceRegistryPath || !publicationPlanPath) throw new Error(usage());
  return { sourceRegistryPath, publicationPlanPath, comparisonManifestPaths };
}

async function main() {
  const [catalogPath, outputDirectory, ...rest] = process.argv.slice(2);
  if (!catalogPath || !outputDirectory) throw new Error(usage());
  const catalog = JSON.parse(await readFile(resolve(catalogPath), "utf8")) as unknown;
  const schemaVersion = z.object({ schemaVersion: z.number().int() }).parse(catalog).schemaVersion;
  let packs;
  if (schemaVersion === 1) {
    if (rest.length > 0) throw new Error(usage());
    packs = buildIssuePacks(catalog);
  } else if (schemaVersion === 2) {
    const arguments_ = parseExpandedArguments(rest);
    const [registry, plan, comparisonManifests] = await Promise.all([
      readFile(resolve(arguments_.sourceRegistryPath), "utf8").then(
        (value) => JSON.parse(value) as unknown,
      ),
      readFile(resolve(arguments_.publicationPlanPath), "utf8").then(
        (value) => JSON.parse(value) as unknown,
      ),
      Promise.all(arguments_.comparisonManifestPaths.map((path) => loadIssueManifest(path))),
    ]);
    packs = buildExpandedIssuePacks(catalog, registry, plan, {
      comparisonIssues: collectComparisonIssues(
        comparisonManifests.map((loaded) => loaded.manifest),
      ),
    });
  } else {
    throw new Error(`Unsupported catalog schemaVersion ${schemaVersion}.`);
  }
  const absoluteOutputDirectory = resolve(outputDirectory);
  await mkdir(absoluteOutputDirectory, { recursive: true });
  for (const pack of packs) {
    const safeFileName = basename(pack.fileName);
    const formattedManifest = await format(JSON.stringify(pack.manifest), { parser: "json" });
    await writeFile(resolve(absoluteOutputDirectory, safeFileName), formattedManifest, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        built: packs.map((pack) => ({
          fileName: pack.fileName,
          packId: pack.manifest.packId,
          issueCount: pack.manifest.issues.length,
        })),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
