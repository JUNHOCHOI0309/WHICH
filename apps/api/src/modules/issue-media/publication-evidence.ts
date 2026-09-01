import { createHash } from "node:crypto";

import {
  evaluateModerationDecision,
  type ModerationDecisionRuntime,
} from "../moderation/decision-engine.js";
import { MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION } from "../moderation/decision-threshold-registry.js";
import { MODERATION_POLICY_VERSION } from "../moderation/policy-registry.js";
import {
  PROVISIONAL_EVIDENCE_VERSION,
  type ProvisionalEvidence,
} from "../moderation/provisional-evidence.js";
import {
  evaluatePublicationReadiness,
  type PublicationReadinessInput,
} from "./publication-readiness.js";
import { ISSUE_MEDIA_RULE_POLICY_VERSION } from "./upload-gate-policy.js";
import { TRUSTED_IMAGE_UPLOADER_POLICY_VERSION } from "./trusted-uploader-policy.js";
import { MODERATION_POLICY_VERSION as SHADOW_POLICY_VERSION } from "../moderation-dispatch/contracts.js";

export const PUBLICATION_EVIDENCE_RESOLVER_VERSION = "which-publication-evidence-resolver-v1";
// Observation lifetime only. This is not an execution lease or permission to reuse a snapshot.
const OBSERVATION_TTL_MS = 5 * 60 * 1000;
export type PublicationAccessEvidence = {
  member: { id: string; status: string } | null;
  capability: {
    id: string;
    memberId: string;
    state: string;
    policyVersion: string;
    grantedAt: Date;
    expiresAt: Date;
  } | null;
  consent: {
    id: string;
    memberId: string;
    consentVersion: string;
    acceptedAt: Date;
    revokedAt: Date | null;
  } | null;
  requiredConsentVersion: string;
};
type Check = ProvisionalEvidence["checks"][number] & { reasons: string[] };

/** Internal DB projection only: never accept client-supplied checks or cached readiness. */
export function resolvePublicationEvidence(input: {
  snapshot: PublicationReadinessInput;
  access: PublicationAccessEvidence;
  runtime: ModerationDecisionRuntime;
}) {
  const { snapshot, access } = input;
  const readiness = evaluatePublicationReadiness(snapshot);
  const now = snapshot.evaluatedAt;
  const validUntil = new Date(now.getTime() + OBSERVATION_TTL_MS).toISOString();
  const checks: Check[] = [];
  const globalReasons = readiness.blockers.filter((code) =>
    ["SUBMISSION_BINDING_MISMATCH", "SUBMISSION_NOT_PENDING", "IMAGE_PAIR_REQUIRED"].includes(code),
  );
  if (snapshot.runPolicyVersion !== SHADOW_POLICY_VERSION)
    globalReasons.push("RUN_POLICY_UNREGISTERED");
  if (
    !/^[a-f0-9]{64}$/u.test(snapshot.inputHash) ||
    !Number.isSafeInteger(snapshot.targetVersion) ||
    snapshot.targetVersion < 1
  )
    globalReasons.push("INVALID_SUBMISSION_IDENTITY");
  if (access.member?.id !== snapshot.submission?.memberId || access.member?.status !== "ACTIVE")
    globalReasons.push("MEMBER_NOT_ACTIVE");
  const assetReasons = readiness.blockers.filter((code) =>
    /^(CONTEXT|A|B|C|D)_(ASSET_OWNERSHIP_INVALID|ASSET_NOT_PRIVATE_READY|ASSET_VERSION_MISSING)$/u.test(
      code,
    ),
  );
  globalReasons.push(...assetReasons);
  const media = [
    snapshot.submission?.contextMediaAssetId,
    snapshot.submission?.mediaAssetAId,
    snapshot.submission?.mediaAssetBId,
    snapshot.submission?.mediaAssetCId,
    snapshot.submission?.mediaAssetDId,
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => snapshot.assets.find((asset) => asset.id === id));
  const binding = media.map((asset) =>
    asset ? [asset.id, asset.sourceHash, asset.normalizedHash] : null,
  );
  if (media.some((asset) => !asset || !/^[a-f0-9]{64}$/u.test(asset.sourceHash)))
    globalReasons.push("SOURCE_HASH_INVALID");

  function add(
    check: string,
    reasons: string[],
    sourceVersion: string,
    refs: unknown,
    status: Check["status"] = "REVIEW",
    expiry = validUntil,
  ) {
    const allReasons = [...new Set([...globalReasons, ...reasons])];
    // Include the source references and current pair, never source text, in an opaque provenance ID.
    const evidenceId = createHash("sha256")
      .update(
        JSON.stringify([
          PUBLICATION_EVIDENCE_RESOLVER_VERSION,
          check,
          snapshot.submission?.id,
          snapshot.targetVersion,
          snapshot.inputHash,
          binding,
          sourceVersion,
          refs,
          allReasons,
          now.toISOString(),
          expiry,
        ]),
      )
      .digest("hex");
    checks.push({
      check,
      status: allReasons.length ? status : "PASS",
      reasons: allReasons,
      evidenceId,
      inputHash: snapshot.inputHash,
      policyVersion: MODERATION_POLICY_VERSION,
      sourceVersion,
      observedAt: now.toISOString(),
      validUntil: expiry,
    });
  }
  const findReasons = (pattern: RegExp) => readiness.blockers.filter((code) => pattern.test(code));
  const technicalReasons = findReasons(
    /MEDIA_(SOURCE_SIGNATURE_DECODE_VERIFIED|NORMALIZED_WEBP_READY|HASHES_COMPUTED)_MISSING$/u,
  );
  const technicalRefs: string[] = [];
  for (const asset of media) {
    for (const code of [
      "MEDIA_SOURCE_SIGNATURE_DECODE_VERIFIED",
      "MEDIA_NORMALIZED_WEBP_READY",
      "MEDIA_HASHES_COMPUTED",
    ]) {
      const matches = snapshot.findings.filter(
        (f) =>
          asset &&
          f.mediaAssetId === asset.id &&
          f.code === code &&
          f.stage === (code === "MEDIA_HASHES_COMPUTED" ? "HASH" : "NORMALIZATION") &&
          f.severity === "INFO" &&
          f.sourceVersion === ISSUE_MEDIA_RULE_POLICY_VERSION &&
          f.evidence.policyVersion === ISSUE_MEDIA_RULE_POLICY_VERSION &&
          f.evidence.sourceSha256 === asset.sourceHash &&
          f.evidence.normalizedSha256 === asset.normalizedHash,
      );
      if (
        matches.length !== 1 ||
        !matches[0]?.id ||
        !matches[0].createdAt ||
        !Number.isFinite(matches[0].createdAt.getTime()) ||
        matches[0].createdAt > now
      )
        technicalReasons.push("TECHNICAL_PROVENANCE_MISSING_OR_AMBIGUOUS");
      else technicalRefs.push(matches[0].id);
    }
  }
  if (new Set(technicalRefs).size !== technicalRefs.length)
    technicalReasons.push("TECHNICAL_PROVENANCE_DUPLICATED");
  add("TECHNICAL", technicalReasons, ISSUE_MEDIA_RULE_POLICY_VERSION, technicalRefs);
  add(
    "KNOWN_BLOCK",
    findReasons(/_KNOWN_BLOCK_HASH$/u),
    ISSUE_MEDIA_RULE_POLICY_VERSION,
    [...snapshot.knownBlockedHashes].sort(),
    "FAIL",
  );

  const localReasons = findReasons(
    /_(LOCAL_ROUTE_MISSING_OR_AMBIGUOUS|LOCAL_RULE_GATE_NOT_ENFORCING|LOCAL_DETECTOR_UNREGISTERED|LOCAL_SCAN_FAILED|QR_SCAN_INCOMPLETE|BARCODE_SCAN_INCOMPLETE|OCR_SCAN_INCOMPLETE)$/u,
  );
  const localRefs: string[] = [];
  for (const asset of media) {
    const routes = snapshot.findings.filter(
      (f) =>
        asset &&
        f.mediaAssetId === asset.id &&
        f.stage === "ROUTING" &&
        f.sourceVersion === ISSUE_MEDIA_RULE_POLICY_VERSION &&
        f.evidence.sourceSha256 === asset.sourceHash &&
        f.evidence.normalizedSha256 === asset.normalizedHash &&
        f.evidence.policyVersion === ISSUE_MEDIA_RULE_POLICY_VERSION,
    );
    if (
      routes.length !== 1 ||
      !routes[0]?.id ||
      !routes[0].createdAt ||
      !Number.isFinite(routes[0].createdAt.getTime()) ||
      routes[0].createdAt > now ||
      !["MEDIA_ROUTE_REVIEW_READY", "MEDIA_ROUTE_REVIEW_REQUIRED"].includes(routes[0].code)
    )
      localReasons.push("LOCAL_PROVENANCE_MISSING_OR_AMBIGUOUS");
    else localRefs.push(routes[0].id);
  }
  if (new Set(localRefs).size !== localRefs.length)
    localReasons.push("LOCAL_PROVENANCE_DUPLICATED");
  if (
    snapshot.findings.some(
      (f) =>
        media.some((a) => a?.id === f.mediaAssetId) &&
        ["MEDIA_QR_DETECTED", "MEDIA_BARCODE_DETECTED", "MEDIA_OCR_PII_DETECTED"].includes(f.code),
    )
  )
    localReasons.push("LOCAL_PII_OR_EMBEDDED_CODE_REVIEW");
  localReasons.push(
    ...findReasons(/EMBEDDED_TEXT.*(WITHHELD_PII|BINDING_MISMATCH|PARTIAL|UNAVAILABLE|MISSING)$/u),
  );
  add("LOCAL_PII", localReasons, ISSUE_MEDIA_RULE_POLICY_VERSION, localRefs);
  add(
    "LOCAL_VISUAL",
    ["VISUAL_ENGINE_NOT_IMPLEMENTED"],
    PUBLICATION_EVIDENCE_RESOLVER_VERSION,
    null,
    "UNAVAILABLE",
  );

  // Existing LOW bands and supported category scores are observations, not calibrated clear evidence.
  // Do not manufacture 1-max(score), duplicate A/B aggregate scores, or trust a provider PASS field.
  const providerReasons = readiness.blockers.filter((code) =>
    /^(PROVIDER_|MULTIMODAL_|IMAGE_COVERAGE_|TEXT_COVERAGE_|EMBEDDED_TEXT_|[AB]_EMBEDDED_TEXT_)/u.test(
      code,
    ),
  );
  for (const check of ["IMAGE_SAFETY", "CONTEXT_SAFETY"])
    add(
      check,
      [...providerReasons, "CALIBRATED_CLEAR_EVIDENCE_REQUIRED"],
      PUBLICATION_EVIDENCE_RESOLVER_VERSION,
      null,
      providerReasons.length ? "REVIEW" : "UNAVAILABLE",
    );
  // This checks the current declaration state only; it does not adjudicate copyright ownership.
  add(
    "RIGHTS",
    findReasons(/_RIGHTS_UNAVAILABLE$/u),
    ISSUE_MEDIA_RULE_POLICY_VERSION,
    media.map((asset) => asset?.rightsState),
  );

  const cap = access.capability;
  const capReasons: string[] = [];
  if (!cap || cap.memberId !== snapshot.submission?.memberId || cap.state !== "ACTIVE")
    capReasons.push("CAPABILITY_REQUIRED");
  if (cap && cap.policyVersion !== TRUSTED_IMAGE_UPLOADER_POLICY_VERSION)
    capReasons.push("CAPABILITY_POLICY_STALE");
  if (
    cap &&
    (!Number.isFinite(cap.grantedAt.getTime()) ||
      !Number.isFinite(cap.expiresAt.getTime()) ||
      cap.grantedAt > now ||
      cap.expiresAt <= now ||
      cap.expiresAt <= cap.grantedAt)
  )
    capReasons.push("CAPABILITY_TIME_INVALID_OR_EXPIRED");
  const capExpiry =
    cap && capReasons.length === 0
      ? new Date(Math.min(Date.parse(validUntil), cap.expiresAt.getTime())).toISOString()
      : validUntil;
  add(
    "CAPABILITY",
    capReasons,
    TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
    cap?.id ?? null,
    "REVIEW",
    capExpiry,
  );
  const consent = access.consent;
  const consentReasons: string[] = [];
  if (
    !consent ||
    consent.memberId !== snapshot.submission?.memberId ||
    consent.revokedAt !== null ||
    !access.requiredConsentVersion.trim() ||
    consent.consentVersion !== access.requiredConsentVersion
  )
    consentReasons.push("CURRENT_CONSENT_REQUIRED");
  if (consent && (!Number.isFinite(consent.acceptedAt.getTime()) || consent.acceptedAt > now))
    consentReasons.push("CONSENT_TIME_INVALID");
  add("CONSENT", consentReasons, access.requiredConsentVersion, consent?.id ?? null);

  const evidence: ProvisionalEvidence = { version: PROVISIONAL_EVIDENCE_VERSION, checks };
  const decision = evaluateModerationDecision({
    runtime: input.runtime,
    request: {
      policyVersion: MODERATION_POLICY_VERSION,
      thresholdRegistryVersion: MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
      requestedAction: "PROVISIONAL",
      reasonCode: "NO_POLICY_VIOLATION",
      contentKind: "ISSUE_MEDIA",
      modality: "TEXT_AND_IMAGE",
      slice: "LOW_RISK_ISSUE_MEDIA",
      category: "ISSUE_MEDIA",
      source: "MODEL",
      contextState: globalReasons.length ? "INSUFFICIENT" : "SUFFICIENT",
      providerStatus: snapshot.runStatus === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      // No registered calibrated clear source exists yet. Never synthesize one from risk scores.
      signals: [],
      normalizedInputHash: snapshot.inputHash,
      evaluatedAt: now,
      provisionalEvidence: evidence,
    },
  });
  return {
    version: PUBLICATION_EVIDENCE_RESOLVER_VERSION,
    evaluatedAt: now.toISOString(),
    targetVersion: snapshot.targetVersion,
    inputHash: snapshot.inputHash,
    checks,
    decision,
    executionAuthorized: false as const,
    executionBlockers: [
      snapshot.runMode === "SHADOW"
        ? "SHADOW_IS_NOT_EXECUTION_AUTHORITY"
        : "EXECUTION_MODE_UNSUPPORTED",
      "CURRENT_PRIVACY_BUDGET_AND_RELEASE_REVALIDATION_REQUIRED",
      "PUBLICATION_EXECUTOR_NOT_CONNECTED",
    ],
  };
}
