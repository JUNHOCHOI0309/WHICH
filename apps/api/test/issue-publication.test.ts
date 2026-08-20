import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  computeIssueContentHash,
  computeManifestDigest,
} from "../src/modules/issue-publication/content-hash.js";
import { parseIssueManifest } from "../src/modules/issue-publication/manifest.js";
import {
  assertIssuePublicationConfirmation,
  assertIssuePublicationTarget,
} from "../src/modules/issue-publication/service.js";

const manifestPath = fileURLToPath(
  new URL("../content/issue-packs/which-19-initial-low-v1.json", import.meta.url),
);

async function loadRawManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
}

async function loadManifestDigest() {
  return computeManifestDigest(await readFile(manifestPath));
}

describe("WHICH-19 Issue Manifest", () => {
  it("contains exactly the twelve approved LOW, non-political Issues", async () => {
    const manifest = parseIssueManifest(await loadRawManifest());

    expect(manifest.packId).toBe("which-19-initial-low-v1");
    expect(manifest.target).toBe("production");
    expect(manifest.issues).toHaveLength(12);
    expect(manifest.issues.every((issue) => issue.riskLevel === "LOW")).toBe(true);
    expect(manifest.issues.every((issue) => !issue.isPolitical)).toBe(true);
    expect(
      manifest.issues.every(
        (issue) => issue.choices[0].code === "A" && issue.choices[1].code === "B",
      ),
    ).toBe(true);
  });

  it("rejects drift from the approved meaning hash", async () => {
    const raw = await loadRawManifest();
    const issues = raw.issues as Array<Record<string, unknown>>;
    issues[0]!.question = "승인 후 바뀐 질문";

    expect(() => parseIssueManifest(raw)).toThrow(/Content hash does not match/);
  });

  it("rejects MEDIUM content, duplicate IDs, and duplicate wording", async () => {
    const medium = await loadRawManifest();
    ((medium.issues as Array<Record<string, unknown>>)[0] as Record<string, unknown>).riskLevel =
      "MEDIUM";
    expect(() => parseIssueManifest(medium)).toThrow();

    const duplicateId = await loadRawManifest();
    const duplicateIdIssues = duplicateId.issues as Array<{
      id: string;
      choices: Array<{ id: string }>;
    }>;
    duplicateIdIssues[1]!.choices[0]!.id = duplicateIdIssues[0]!.id;
    expect(() => parseIssueManifest(duplicateId)).toThrow(/Domain ID duplicates/);

    const duplicateWording = await loadRawManifest();
    const duplicateWordingIssues = duplicateWording.issues as Array<{
      question: string;
      context: string;
      choices: Array<{ id: string; code: "A" | "B"; label: string }>;
      contentHash: string;
    }>;
    duplicateWordingIssues[1]!.question = duplicateWordingIssues[0]!.question;
    duplicateWordingIssues[1]!.context = duplicateWordingIssues[0]!.context;
    duplicateWordingIssues[1]!.choices[0]!.label = duplicateWordingIssues[0]!.choices[0]!.label;
    duplicateWordingIssues[1]!.choices[1]!.label = duplicateWordingIssues[0]!.choices[1]!.label;
    duplicateWordingIssues[1]!.contentHash = computeIssueContentHash(duplicateWordingIssues[1]!);
    expect(() => parseIssueManifest(duplicateWording)).toThrow(/Issue wording duplicates/);
  });

  it("requires an exact target and destructive confirmation", async () => {
    const manifest = parseIssueManifest(await loadRawManifest());
    const manifestDigest = await loadManifestDigest();

    expect(() => assertIssuePublicationTarget(manifest, "staging")).toThrow(/Target mismatch/);
    expect(() =>
      assertIssuePublicationConfirmation(
        manifest,
        "production",
        manifestDigest,
        `production:which-19-initial-low-v1:${"0".repeat(64)}`,
      ),
    ).toThrow(/must exactly equal/);
    expect(() =>
      assertIssuePublicationConfirmation(
        manifest,
        "production",
        manifestDigest,
        `production:which-19-initial-low-v1:${manifestDigest}`,
      ),
    ).not.toThrow();
  });
});
