export const PROVISIONAL_EVIDENCE_VERSION = "which-provisional-evidence-v1";
export const PROVISIONAL_REQUIRED_CHECKS = [
  "TECHNICAL",
  "KNOWN_BLOCK",
  "LOCAL_PII",
  "LOCAL_VISUAL",
  "IMAGE_SAFETY",
  "CONTEXT_SAFETY",
  "RIGHTS",
  "CAPABILITY",
  "CONSENT",
] as const;

export type ProvisionalEvidence = {
  version: string;
  checks: ReadonlyArray<{
    check: string;
    status: "PASS" | "REVIEW" | "FAIL" | "UNAVAILABLE";
    evidenceId: string;
    inputHash: string;
    policyVersion: string;
    sourceVersion: string;
    observedAt: string;
    validUntil: string;
  }>;
};

// This contract is not a provider output schema. Only an internal, policy-bound evidence
// resolver may construct it. A boolean from a client, a score, or a Shadow run is not proof.
export function validateProvisionalEvidence(input: {
  evidence?: ProvisionalEvidence;
  inputHash: string;
  policyVersion: string;
  now: Date;
}): "MISSING_PUBLICATION_CHECKS" | "INVALID_PUBLICATION_EVIDENCE" | null {
  const evidence = input.evidence;
  if (!evidence || evidence.version !== PROVISIONAL_EVIDENCE_VERSION)
    return "MISSING_PUBLICATION_CHECKS";
  const now = input.now.getTime();
  if (!Number.isFinite(now) || !/^[a-f0-9]{64}$/u.test(input.inputHash))
    return "INVALID_PUBLICATION_EVIDENCE";
  if (evidence.checks.length !== PROVISIONAL_REQUIRED_CHECKS.length)
    return "MISSING_PUBLICATION_CHECKS";
  for (const check of PROVISIONAL_REQUIRED_CHECKS) {
    const matches = evidence.checks.filter((entry) => entry.check === check);
    if (matches.length !== 1) return "MISSING_PUBLICATION_CHECKS";
    const entry = matches[0]!;
    const observed = Date.parse(entry.observedAt);
    const expiry = Date.parse(entry.validUntil);
    if (
      entry.status !== "PASS" ||
      !entry.evidenceId.trim() ||
      !entry.sourceVersion.trim() ||
      entry.inputHash !== input.inputHash ||
      entry.policyVersion !== input.policyVersion ||
      !Number.isFinite(observed) ||
      !Number.isFinite(expiry) ||
      observed > now ||
      expiry <= now ||
      expiry <= observed
    )
      return "INVALID_PUBLICATION_EVIDENCE";
  }
  return null;
}
