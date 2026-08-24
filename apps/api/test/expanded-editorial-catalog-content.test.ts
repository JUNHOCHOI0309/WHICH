import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeIssueSemanticFingerprint } from "../src/modules/issue-publication/content-hash.js";
import {
  expandedEditorialCatalogSchema,
  factSourceRegistrySchema,
} from "../src/modules/issue-publication/editorial-catalog.js";
import { parseIssueManifest } from "../src/modules/issue-publication/manifest.js";

const contentRoot = new URL("../content/editorial/expanded/", import.meta.url);

async function readJson(path: URL) {
  return JSON.parse(await readFile(fileURLToPath(path), "utf8")) as unknown;
}

describe("WHICH Expanded 500 remediation", () => {
  it("keeps 500 structurally valid candidates and a complete inventory partition", async () => {
    const [catalogValue, registryValue, inventoryValue] = await Promise.all([
      readJson(new URL("which-expanded-500-catalog-v2.json", contentRoot)),
      readJson(new URL("fact-source-registry-v2.json", contentRoot)),
      readJson(new URL("inventory-candidates-v2.json", contentRoot)),
    ]);
    const catalog = expandedEditorialCatalogSchema.parse(catalogValue);
    const registry = factSourceRegistrySchema.parse(registryValue);
    const inventory = inventoryValue as {
      activePoolCandidateIds: string[];
      approvedReserveCandidateIds: string[];
      longTermCandidateIds: string[];
    };

    expect(catalog.issues).toHaveLength(500);
    expect(catalog.approval.status).toBe("PENDING_HUMAN_EDITORIAL_APPROVAL");
    expect(catalog.issues.every((issue) => issue.editorialReview.status !== "HUMAN_APPROVED")).toBe(
      true,
    );
    const inventoryIds = [
      ...inventory.activePoolCandidateIds,
      ...inventory.approvedReserveCandidateIds,
      ...inventory.longTermCandidateIds,
    ];
    expect(inventory.activePoolCandidateIds).toHaveLength(72);
    expect(inventory.approvedReserveCandidateIds).toHaveLength(108);
    expect(inventory.longTermCandidateIds).toHaveLength(320);
    expect(new Set(inventoryIds).size).toBe(500);
    expect(new Set(inventoryIds)).toEqual(
      new Set(catalog.issues.map((issue) => issue.candidateId)),
    );

    const sourceIds = new Set(registry.sources.map((source) => source.id));
    for (const issue of catalog.issues) {
      for (const sourceId of issue.sourceProfile.factSourceIds) {
        expect(sourceIds.has(sourceId), `${issue.candidateId}:${sourceId}`).toBe(true);
      }
    }
  });

  it("has no exact semantic collision with the existing approved WHICH-19/49 inventory", async () => {
    const catalog = expandedEditorialCatalogSchema.parse(
      await readJson(new URL("which-expanded-500-catalog-v2.json", contentRoot)),
    );
    const existingPaths = [
      "../../issue-packs/which-19-initial-low-v1.json",
      "../../issue-packs/which-49-active-expansion-v1.json",
      "../../issue-packs/which-49-approved-reserve-day-1-v1.json",
      "../../issue-packs/which-49-approved-reserve-day-2-v1.json",
      "../../issue-packs/which-49-approved-reserve-day-3-v1.json",
    ];
    const existing = (
      await Promise.all(
        existingPaths.map(async (path) =>
          parseIssueManifest(await readJson(new URL(path, contentRoot))),
        ),
      )
    ).flatMap((manifest) => manifest.issues);
    const approvedFingerprints = new Set(existing.map(computeIssueSemanticFingerprint));

    for (const issue of catalog.issues) {
      expect(
        approvedFingerprints.has(computeIssueSemanticFingerprint(issue)),
        issue.candidateId,
      ).toBe(false);
    }
  });
});
