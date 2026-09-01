import { describe, expect, it } from "vitest";

import {
  evaluatePublicationReadiness,
  type PublicationReadinessInput,
} from "../src/modules/issue-media/publication-readiness.js";
import { ISSUE_MEDIA_RULE_POLICY_VERSION } from "../src/modules/issue-media/upload-gate-policy.js";
import { LOCAL_SCAN_VERSION } from "../src/modules/issue-media/local-scan-contract.js";
import { EMBEDDED_TEXT_VERSION } from "../src/modules/issue-media/embedded-text.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "../src/modules/moderation-providers/contracts.js";
import {
  OPENAI_IMAGE_LABELS,
  OPENAI_TEXT_LABELS,
  openAiCoverage,
} from "../src/modules/moderation-providers/openai-coverage.js";
import { toImageProviderShadowFindings } from "../src/modules/moderation-providers/image-shadow-findings.js";

function signals() {
  return OPENAI_TEXT_LABELS.map((providerLabel) => ({
    providerLabel,
    canonicalCode: "TEST_ONLY",
    rawScore: 0.001,
    calibratedBand: "LOW" as const,
    flagged: false,
    regions: [],
    appliedModalities: OPENAI_IMAGE_LABELS.some((label) => label === providerLabel)
      ? ["TEXT" as const, "IMAGE" as const]
      : ["TEXT" as const],
  }));
}

function fixture(): PublicationReadinessInput {
  const assets = ["asset-a", "asset-b"].map((id, index) => ({
    id,
    ownerId: "member",
    sourceType: "MEMBER_SUBMISSION",
    sourceHash: String(index + 1).repeat(64),
    normalizedHash: String(index + 3).repeat(64),
    processingState: "READY",
    moderationState: "PENDING",
    storageState: "STAGED",
    rightsState: "ASSERTED",
  }));
  return {
    targetVersion: 1,
    inputHash: "a".repeat(64),
    runStatus: "SUCCEEDED",
    runMode: "SHADOW",
    evaluatedAt: new Date("2026-08-30T00:00:00Z"),
    submission: {
      id: "submission",
      memberId: "member",
      revision: 1,
      contentHash: "a".repeat(64),
      status: "PENDING",
      publishedIssueId: null,
      mediaAssetAId: "asset-a",
      mediaAssetBId: "asset-b",
    },
    assets,
    knownBlockedHashes: new Set(),
    findings: assets.flatMap((asset) =>
      [
        "MEDIA_SOURCE_SIGNATURE_DECODE_VERIFIED",
        "MEDIA_NORMALIZED_WEBP_READY",
        "MEDIA_HASHES_COMPUTED",
        "MEDIA_ROUTE_REVIEW_READY",
      ].map((code) => ({
        mediaAssetId: asset.id,
        code,
        stage: code === "MEDIA_ROUTE_REVIEW_READY" ? "ROUTING" : "NORMALIZE",
        severity: "INFO",
        sourceVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
        evidence: {
          policyVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
          sourceSha256: asset.sourceHash,
          normalizedSha256: asset.normalizedHash,
          ruleGateMode: "ENFORCE",
          detectorVersion: LOCAL_SCAN_VERSION,
          scanStatus: {
            qr: "COMPLETE",
            barcode: "COMPLETE",
            ocr: "COMPLETE",
            visual: "UNAVAILABLE",
          },
        },
      })),
    ),
    providerResult: {
      schemaVersion: 1,
      provider: "OPENAI_MODERATION",
      modality: "TEXT_AND_IMAGE",
      modelSnapshot: "omni-moderation-2024-09-26",
      supportedLabels: [],
      unsupportedLabels: [],
      signals: signals(),
      abstained: false,
      providerDisagreement: null,
      capabilities: { boundingBoxes: false },
      publicationChanged: false,
      inputContractVersion: MODERATION_PROVIDER_INPUT_VERSION,
      inputScope: "SUBMISSION_REVISION",
      imageCount: 2,
      inputBinding: {
        contractVersion: MODERATION_PROVIDER_INPUT_VERSION,
        targetType: "ISSUE_VERSION",
        targetVersion: 1,
        inputHash: "a".repeat(64),
      },
    },
  };
}

describe("publication evidence readiness (observation only)", () => {
  it("accepts complete bound OCR observations without granting publication authority", () => {
    const f = fixture();
    f.providerResult.embeddedText = {
      version: EMBEDDED_TEXT_VERSION,
      images: f.assets.map((asset) => ({
        normalizedHash: asset.normalizedHash,
        status: "COMPLETE",
        characters: 25,
      })),
    };
    const result = evaluatePublicationReadiness(f);
    expect(result.blockers.some((code) => code.includes("EMBEDDED_TEXT"))).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.blockers).toContain("A_VISUAL_ENGINE_NOT_IMPLEMENTED");
  });
  it("checks each image's OCR binding and incomplete or withheld evidence", () => {
    const f = fixture();
    f.providerResult.embeddedText = {
      version: EMBEDDED_TEXT_VERSION,
      images: [
        { normalizedHash: "e".repeat(64), status: "PARTIAL", characters: 10 },
        { normalizedHash: f.assets[1]!.normalizedHash, status: "WITHHELD_PII", characters: 0 },
      ],
    };
    expect(evaluatePublicationReadiness(f).blockers).toEqual(
      expect.arrayContaining([
        "A_EMBEDDED_TEXT_BINDING_MISMATCH",
        "A_EMBEDDED_TEXT_PARTIAL",
        "B_EMBEDDED_TEXT_WITHHELD_PII",
      ]),
    );
  });
  it("does not interpret low provider scores and clean local scans as a calibrated clear decision", () => {
    const result = evaluatePublicationReadiness(fixture());
    expect(result).toMatchObject({ state: "PRIVATE_REVIEW_REQUIRED", executionAuthorized: false });
    expect(result.blockers).toEqual([
      "A_VISUAL_SCAN_INCOMPLETE",
      "A_VISUAL_ENGINE_NOT_IMPLEMENTED",
      "B_VISUAL_SCAN_INCOMPLETE",
      "B_VISUAL_ENGINE_NOT_IMPLEMENTED",
      "EMBEDDED_TEXT_EVIDENCE_MISSING",
    ]);
    expect(result.executionBlockers).toContain("SHADOW_IS_NOT_EXECUTION_AUTHORITY");
    expect(result.executionBlockers).toContain("CALIBRATED_CLEAR_EVIDENCE_REQUIRED");
    expect(result.providerCoverage?.missingImageLabels).toEqual([]);
  });

  it("keeps previously published owned assets eligible for a new contextual review", () => {
    const f = fixture();
    for (const asset of f.assets) {
      asset.moderationState = "APPROVED";
      asset.storageState = "PUBLISHED";
    }
    const result = evaluatePublicationReadiness(f);
    expect(result.blockers).not.toContain("A_ASSET_NOT_PRIVATE_READY");
    expect(result.blockers).not.toContain("B_ASSET_NOT_PRIVATE_READY");
    expect(result.executionAuthorized).toBe(false);
  });

  it.each([
    [
      "missing submission",
      "SUBMISSION_BINDING_MISMATCH",
      (f: PublicationReadinessInput) => {
        f.submission = null;
      },
    ],
    [
      "new revision",
      "SUBMISSION_BINDING_MISMATCH",
      (f: PublicationReadinessInput) => {
        f.submission!.revision = 2;
      },
    ],
    [
      "new hash",
      "SUBMISSION_BINDING_MISMATCH",
      (f: PublicationReadinessInput) => {
        f.submission!.contentHash = "b".repeat(64);
      },
    ],
    [
      "cancelled",
      "SUBMISSION_NOT_PENDING",
      (f: PublicationReadinessInput) => {
        f.submission!.status = "CANCELLED";
      },
    ],
    [
      "published",
      "SUBMISSION_NOT_PENDING",
      (f: PublicationReadinessInput) => {
        f.submission!.publishedIssueId = "issue";
      },
    ],
    [
      "duplicate A/B",
      "IMAGE_PAIR_REQUIRED",
      (f: PublicationReadinessInput) => {
        f.submission!.mediaAssetBId = "asset-a";
      },
    ],
    [
      "wrong owner",
      "B_ASSET_OWNERSHIP_INVALID",
      (f: PublicationReadinessInput) => {
        f.assets[1]!.ownerId = "other";
      },
    ],
    [
      "quarantined",
      "B_ASSET_NOT_PRIVATE_READY",
      (f: PublicationReadinessInput) => {
        f.assets[1]!.storageState = "QUARANTINED";
      },
    ],
    [
      "rights revoked",
      "B_RIGHTS_UNAVAILABLE",
      (f: PublicationReadinessInput) => {
        f.assets[1]!.rightsState = "REVOKED";
      },
    ],
    [
      "missing hash",
      "B_ASSET_VERSION_MISSING",
      (f: PublicationReadinessInput) => {
        f.assets[1]!.normalizedHash = null;
      },
    ],
    [
      "known block",
      "B_KNOWN_BLOCK_HASH",
      (f: PublicationReadinessInput) => {
        f.knownBlockedHashes = new Set([f.assets[1]!.sourceHash]);
      },
    ],
    [
      "scan timeout",
      "B_LOCAL_SCAN_FAILED",
      (f: PublicationReadinessInput) => {
        f.findings[7]!.evidence.scanFailureCode = "TIMEOUT";
      },
    ],
    [
      "rule disabled",
      "B_LOCAL_RULE_GATE_NOT_ENFORCING",
      (f: PublicationReadinessInput) => {
        f.findings[7]!.evidence.ruleGateMode = "OFF";
      },
    ],
    [
      "stale local evidence",
      "B_LOCAL_ROUTE_MISSING_OR_AMBIGUOUS",
      (f: PublicationReadinessInput) => {
        f.findings[7]!.evidence.normalizedSha256 = "f".repeat(64);
      },
    ],
    [
      "PII finding",
      "B_LOCAL_REVIEW_SIGNAL",
      (f: PublicationReadinessInput) => {
        f.findings[7]!.severity = "REVIEW";
      },
    ],
    [
      "model failed",
      "PROVIDER_NOT_SUCCEEDED",
      (f: PublicationReadinessInput) => {
        f.runStatus = "DEAD_LETTERED";
      },
    ],
    [
      "old provider input",
      "PROVIDER_INPUT_BINDING_INVALID",
      (f: PublicationReadinessInput) => {
        f.providerResult.inputBinding = {};
      },
    ],
    [
      "partial coverage",
      "IMAGE_COVERAGE_INCOMPLETE",
      (f: PublicationReadinessInput) => {
        f.providerResult.signals = signals().slice(0, 1);
      },
    ],
    [
      "flagged category",
      "PROVIDER_REVIEW_SIGNAL",
      (f: PublicationReadinessInput) => {
        f.providerResult.signals = signals().map((signal) => ({ ...signal, flagged: true }));
      },
    ],
    [
      "abstained",
      "PROVIDER_ABSTAINED",
      (f: PublicationReadinessInput) => {
        f.providerResult.abstained = true;
      },
    ],
    [
      "unknown model",
      "PROVIDER_MODEL_UNREGISTERED",
      (f: PublicationReadinessInput) => {
        f.providerResult.modelSnapshot = "other";
      },
    ],
  ] as const)("records %s without publishing", (_name, code, mutate) => {
    const f = fixture();
    mutate(f);
    const result = evaluatePublicationReadiness(f);
    expect(result.executionAuthorized).toBe(false);
    expect(result.blockers).toContain(code);
  });

  it("rejects forged coverage and does not echo raw text or provider payloads", () => {
    const f = fixture();
    f.findings[7]!.evidence.scanStatus = {
      qr: "COMPLETE",
      barcode: "COMPLETE",
      ocr: "COMPLETE",
      visual: "COMPLETE",
    };
    f.findings[7]!.evidence.rawOcrText = "secret-contact@example.test";
    f.providerResult.modalityCoverage = { localVisualChecksSupported: true };
    f.providerResult.publicationReadiness = { executionAuthorized: true };
    f.providerResult.rawBody = "never expose me";
    const result = evaluatePublicationReadiness(f);
    expect(result.blockers).toContain("B_VISUAL_ENGINE_NOT_IMPLEMENTED");
    expect(result.providerCoverage?.localVisualChecksSupported).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-contact");
    expect(JSON.stringify(result)).not.toContain("never expose me");
    expect(result.executionAuthorized).toBe(false);
  });

  it("never calls text-only categories image coverage even if reported as IMAGE", () => {
    const forged = signals().map((signal) => ({
      ...signal,
      appliedModalities: ["IMAGE" as const],
    }));
    const result = openAiCoverage(forged);
    expect(result.imageLabels).not.toContain("sexual/minors");
    expect(result.imageLabels).not.toContain("harassment");
    expect(result.imageUnsupportedLabels).toContain("sexual/minors");
    expect(result.missingTextLabels).toHaveLength(OPENAI_TEXT_LABELS.length);
    const capability = toImageProviderShadowFindings({
      result: { ...fixture().providerResult, signals: forged },
      policyVersion: "shadow-v1",
      cacheHit: false,
    }).find((finding) => finding.code === "MEDIA_AI_PROVIDER_CAPABILITIES");
    expect(capability?.evidence.modalityCoverage).toEqual(result);
  });
});
