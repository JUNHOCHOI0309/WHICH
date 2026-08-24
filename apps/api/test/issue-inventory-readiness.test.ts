import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildIssuePacks } from "../src/issue-pack-builder.js";
import {
  evaluateIssueInventory,
  issueInventoryPolicySchema,
  loadIssueInventoryReadiness,
} from "../src/modules/issue-publication/inventory.js";
import { parseIssueManifest } from "../src/modules/issue-publication/manifest.js";

const policyPath = fileURLToPath(
  new URL("../content/issue-packs/public-v0-inventory-policy.json", import.meta.url),
);
const catalogPath = fileURLToPath(
  new URL("../content/editorial/which-49-public-v0-catalog-v1.json", import.meta.url),
);
const originalPackPath = fileURLToPath(
  new URL("../content/issue-packs/which-19-initial-low-v1.json", import.meta.url),
);

async function loadFixture() {
  const [policyValue, catalogValue, originalValue] = await Promise.all([
    readFile(policyPath, "utf8").then((value) => JSON.parse(value) as unknown),
    readFile(catalogPath, "utf8").then((value) => JSON.parse(value) as unknown),
    readFile(originalPackPath, "utf8").then((value) => JSON.parse(value) as unknown),
  ]);
  const policy = issueInventoryPolicySchema.parse(policyValue);
  const generated = buildIssuePacks(catalogValue).map((pack) => pack.manifest);
  return {
    policy,
    active: [parseIssueManifest(originalValue), generated[0]!],
    reserve: generated.slice(1),
    generated,
  };
}

describe("WHICH-49 content readiness", () => {
  it("builds deterministic, valid Issue Packs from the approved editorial catalog", async () => {
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;
    const first = buildIssuePacks(catalog);
    const second = buildIssuePacks(catalog);

    expect(first).toEqual(second);
    expect(first.map((pack) => pack.manifest.issues.length)).toEqual([24, 6, 6, 6]);
    expect(first.flatMap((pack) => pack.manifest.issues)).toHaveLength(42);
    expect(
      first
        .flatMap((pack) => pack.manifest.issues)
        .every((issue) => issue.editorialReview?.status === "PASSED"),
    ).toBe(true);
  });

  it("passes the limited-beta inventory and pool-exhaustion Dry Run", async () => {
    const report = await loadIssueInventoryReadiness(policyPath);

    expect(report.ready).toBe(true);
    expect(report.summary).toMatchObject({
      activeIssues: 36,
      approvedReserveIssues: 18,
      dailyPublicationTarget: 6,
      activeDaysOfSupply: 6,
      reserveDaysOfSupply: 3,
    });
    expect(report.exhaustionDryRun).toMatchObject({
      requiredUniqueIssues: 24,
      unseenActiveBuffer: 12,
      fallback: "STOP_WITH_EMPTY_STATE",
      passed: true,
    });
    expect(report.violations).toEqual([]);
  });

  it("fails closed when inventory or editorial review falls below the contract", async () => {
    const fixture = await loadFixture();
    const shortenedActive = structuredClone(fixture.active);
    shortenedActive[1]!.issues = shortenedActive[1]!.issues.slice(0, 10);
    const unreviewedReserve = structuredClone(fixture.reserve);
    unreviewedReserve[0]!.issues[0]!.editorialReview = undefined;

    const report = evaluateIssueInventory(fixture.policy, shortenedActive, unreviewedReserve);
    const violationCodes = new Set(report.violations.map((violation) => violation.code));

    expect(report.ready).toBe(false);
    expect(violationCodes).toContain("ACTIVE_POOL_BELOW_TARGET");
    expect(violationCodes).toContain("POOL_EXHAUSTION_DRY_RUN");
    expect(violationCodes).toContain("EDITORIAL_REVIEW_MISSING");
  });
});
