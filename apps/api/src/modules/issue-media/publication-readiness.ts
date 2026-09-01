import { normalizedResultSchema } from "../moderation-providers/image-shadow-findings.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "../moderation-providers/contracts.js";
import { openAiCoverage, OPENAI_TEXT_LABELS } from "../moderation-providers/openai-coverage.js";
import { ISSUE_MEDIA_RULE_POLICY_VERSION } from "./upload-gate-policy.js";
import { LOCAL_SCAN_VERSION } from "./local-scan-contract.js";
import { embeddedTextEvidenceSchema } from "./embedded-text.js";

export const PUBLICATION_READINESS_VERSION = "which-publication-readiness-v1";
export type ReadinessAsset = {
  id: string;
  ownerId: string;
  sourceType: string;
  sourceHash: string;
  normalizedHash: string | null;
  processingState: string;
  moderationState: string;
  storageState: string;
  rightsState: string;
};
export type ReadinessFinding = {
  id?: string;
  createdAt?: Date;
  mediaAssetId: string | null;
  stage: string;
  code: string;
  severity: string;
  sourceVersion: string;
  evidence: Record<string, unknown>;
};
export type PublicationReadinessInput = {
  targetVersion: number;
  inputHash: string;
  runStatus: string;
  runMode: string;
  runPolicyVersion?: string;
  providerResult: Record<string, unknown>;
  submission: {
    id: string;
    memberId: string;
    revision: number;
    contentHash: string;
    status: string;
    publishedIssueId: string | null;
    mediaAssetAId: string | null;
    mediaAssetBId: string | null;
    mediaAssetCId?: string | null;
    mediaAssetDId?: string | null;
    contextMediaAssetId?: string | null;
  } | null;
  assets: readonly ReadinessAsset[];
  findings: readonly ReadinessFinding[];
  knownBlockedHashes: ReadonlySet<string>;
  evaluatedAt: Date;
};

// Observation only: this result is deliberately NOT an execution token. It cannot
// satisfy ProvisionalEvidence or convert provider risk scores to a "safe probability".
export function evaluatePublicationReadiness(input: PublicationReadinessInput) {
  const blockers: string[] = [];
  const submission = input.submission;
  if (
    !submission ||
    submission.revision !== input.targetVersion ||
    submission.contentHash !== input.inputHash
  )
    blockers.push("SUBMISSION_BINDING_MISMATCH");
  if (submission?.status !== "PENDING" || submission?.publishedIssueId)
    blockers.push("SUBMISSION_NOT_PENDING");
  const mediaRefs = [
    ["CONTEXT", submission?.contextMediaAssetId],
    ["A", submission?.mediaAssetAId],
    ["B", submission?.mediaAssetBId],
    ["C", submission?.mediaAssetCId],
    ["D", submission?.mediaAssetDId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const ids = mediaRefs.map(([, id]) => id);
  if (ids.length === 0 || new Set(ids).size !== ids.length) blockers.push("IMAGE_PAIR_REQUIRED");

  const assets = mediaRefs.map(([side, id]) => {
    const asset = input.assets.find((entry) => entry.id === id);
    const reasons: string[] = [];
    const add = (reason: string) => {
      reasons.push(reason);
      blockers.push(`${side}_${reason}`);
    };
    if (
      !asset ||
      !submission ||
      asset.ownerId !== submission.memberId ||
      asset.sourceType !== "MEMBER_SUBMISSION"
    )
      add("ASSET_OWNERSHIP_INVALID");
    if (
      !asset ||
      asset.processingState !== "READY" ||
      !(
        (asset.moderationState === "PENDING" && asset.storageState === "STAGED") ||
        (asset.moderationState === "APPROVED" && asset.storageState === "PUBLISHED")
      )
    )
      add("ASSET_NOT_PRIVATE_READY");
    if (!asset || !["ASSERTED", "CLEARED"].includes(asset.rightsState)) add("RIGHTS_UNAVAILABLE");
    if (!asset?.normalizedHash || !/^[a-f0-9]{64}$/u.test(asset.normalizedHash))
      add("ASSET_VERSION_MISSING");
    if (
      asset &&
      (input.knownBlockedHashes.has(asset.sourceHash) ||
        input.knownBlockedHashes.has(asset.normalizedHash ?? ""))
    )
      add("KNOWN_BLOCK_HASH");
    const findings = input.findings.filter(
      (finding) => finding.mediaAssetId === id && finding.stage !== "PROVIDER_SHADOW",
    );
    const bound = findings.filter(
      (finding) =>
        asset &&
        finding.sourceVersion === ISSUE_MEDIA_RULE_POLICY_VERSION &&
        finding.evidence.policyVersion === ISSUE_MEDIA_RULE_POLICY_VERSION &&
        finding.evidence.sourceSha256 === asset.sourceHash &&
        finding.evidence.normalizedSha256 === asset.normalizedHash,
    );
    for (const code of [
      "MEDIA_SOURCE_SIGNATURE_DECODE_VERIFIED",
      "MEDIA_NORMALIZED_WEBP_READY",
      "MEDIA_HASHES_COMPUTED",
    ])
      if (!bound.some((finding) => finding.code === code)) add(`${code}_MISSING`);
    const routes = bound.filter((finding) => finding.stage === "ROUTING");
    const route = routes.length === 1 ? routes[0] : undefined;
    if (!route) add("LOCAL_ROUTE_MISSING_OR_AMBIGUOUS");
    if (findings.some((finding) => finding.severity !== "INFO")) add("LOCAL_REVIEW_SIGNAL");
    if (route?.code !== "MEDIA_ROUTE_REVIEW_READY") add("LOCAL_ROUTE_NOT_CLEAR");
    if (route?.evidence.ruleGateMode !== "ENFORCE") add("LOCAL_RULE_GATE_NOT_ENFORCING");
    if (route?.evidence.detectorVersion !== LOCAL_SCAN_VERSION) add("LOCAL_DETECTOR_UNREGISTERED");
    if (route?.evidence.scanFailureCode) add("LOCAL_SCAN_FAILED");
    const statuses = route?.evidence.scanStatus;
    for (const kind of ["qr", "barcode", "ocr", "visual"] as const) {
      if (
        !statuses ||
        typeof statuses !== "object" ||
        !(kind in statuses) ||
        (statuses as Record<string, unknown>)[kind] !== "COMPLETE"
      )
        add(`${kind.toUpperCase()}_SCAN_INCOMPLETE`);
    }
    // The registered local engine expressly does not implement visual classification.
    // Even a forged COMPLETE field cannot create capability that the engine lacks.
    add("VISUAL_ENGINE_NOT_IMPLEMENTED");
    return { side, assetId: id ?? null, blockers: [...new Set(reasons)] };
  });

  if (input.runStatus !== "SUCCEEDED") blockers.push("PROVIDER_NOT_SUCCEEDED");
  const parsed = normalizedResultSchema.safeParse(input.providerResult);
  let coverage: ReturnType<typeof openAiCoverage> | null = null;
  const binding = input.providerResult.inputBinding;
  if (
    input.providerResult.inputContractVersion !== MODERATION_PROVIDER_INPUT_VERSION ||
    input.providerResult.inputScope !== "SUBMISSION_REVISION" ||
    input.providerResult.imageCount !== ids.length ||
    !binding ||
    typeof binding !== "object" ||
    (binding as Record<string, unknown>).contractVersion !== MODERATION_PROVIDER_INPUT_VERSION ||
    (binding as Record<string, unknown>).targetType !== "ISSUE_VERSION" ||
    (binding as Record<string, unknown>).targetVersion !== input.targetVersion ||
    (binding as Record<string, unknown>).inputHash !== input.inputHash
  )
    blockers.push("PROVIDER_INPUT_BINDING_INVALID");
  if (!parsed.success) blockers.push("PROVIDER_RESULT_INVALID");
  else {
    const result = parsed.data;
    if (
      result.provider !== "OPENAI_MODERATION" ||
      result.modelSnapshot !== "omni-moderation-2024-09-26"
    )
      blockers.push("PROVIDER_MODEL_UNREGISTERED");
    else coverage = openAiCoverage(result.signals);
    if (result.modality !== "TEXT_AND_IMAGE") blockers.push("MULTIMODAL_CONTEXT_REQUIRED");
    if (result.abstained) blockers.push("PROVIDER_ABSTAINED");
    if (result.providerDisagreement === true) blockers.push("PROVIDER_DISAGREEMENT");
    if (result.signals.some((signal) => signal.flagged || signal.calibratedBand !== "LOW"))
      blockers.push("PROVIDER_REVIEW_SIGNAL");
    if (
      result.signals.some(
        (signal) =>
          !OPENAI_TEXT_LABELS.includes(signal.providerLabel as (typeof OPENAI_TEXT_LABELS)[number]),
      )
    )
      blockers.push("PROVIDER_LABEL_UNREGISTERED");
    if (!coverage || coverage.missingImageLabels.length) blockers.push("IMAGE_COVERAGE_INCOMPLETE");
    if (!coverage || coverage.missingTextLabels.length) blockers.push("TEXT_COVERAGE_INCOMPLETE");
  }
  const embedded = embeddedTextEvidenceSchema.safeParse(input.providerResult.embeddedText);
  if (!embedded.success || embedded.data.images.length !== ids.length)
    blockers.push("EMBEDDED_TEXT_EVIDENCE_MISSING");
  else
    embedded.data.images.forEach((image, index) => {
      const side = mediaRefs[index]?.[0] ?? `IMAGE_${index + 1}`;
      const asset = input.assets.find((entry) => entry.id === ids[index]);
      if (!asset || image.normalizedHash !== asset.normalizedHash)
        blockers.push(`${side}_EMBEDDED_TEXT_BINDING_MISMATCH`);
      if (image.status !== "COMPLETE") blockers.push(`${side}_EMBEDDED_TEXT_${image.status}`);
      if (image.characters > 0 && (!coverage || coverage.missingTextLabels.length))
        blockers.push(`${side}_EMBEDDED_TEXT_SAFETY_INCOMPLETE`);
    });
  return {
    version: PUBLICATION_READINESS_VERSION,
    evaluatedAt: input.evaluatedAt.toISOString(),
    targetVersion: input.targetVersion,
    inputHash: input.inputHash,
    executionAuthorized: false as const,
    state: "PRIVATE_REVIEW_REQUIRED" as const,
    blockers: [...new Set(blockers)],
    executionBlockers: [
      ...(input.runMode === "SHADOW"
        ? ["SHADOW_IS_NOT_EXECUTION_AUTHORITY"]
        : ["EXECUTION_MODE_UNSUPPORTED"]),
      "CALIBRATED_CLEAR_EVIDENCE_REQUIRED",
      "CURRENT_ACCESS_AND_RELEASE_GATES_REQUIRED",
      "PUBLICATION_EXECUTOR_NOT_CONNECTED",
    ],
    assets,
    providerCoverage: coverage,
  };
}
