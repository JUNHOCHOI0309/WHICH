import { createHash } from "node:crypto";

export type HashableIssueChoice = {
  id: string;
  code: "A" | "B" | "C" | "D";
  label: string;
};

export type HashableIssueContent = {
  question: string;
  context: string;
  choices: readonly HashableIssueChoice[];
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeManifestDigest(source: string | Uint8Array) {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * This is the v1 Issue meaning hash already used by the development seed and
 * the approved WHICH-19 source pack. Choice IDs are intentionally retained for
 * compatibility with those existing hashes.
 */
export function computeIssueContentHash(issue: HashableIssueContent) {
  return sha256({
    question: issue.question,
    context: issue.context,
    choices: issue.choices.map(({ id, code, label }) => ({ id, code, label })),
  });
}

/**
 * The persisted v1 hash changes when opaque Choice IDs change. This second
 * fingerprint catches duplicate wording that was assigned different IDs.
 */
export function computeIssueSemanticFingerprint(issue: HashableIssueContent) {
  return sha256({
    question: issue.question,
    context: issue.context,
    choices: issue.choices.map(({ code, label }) => ({ code, label })),
  });
}
