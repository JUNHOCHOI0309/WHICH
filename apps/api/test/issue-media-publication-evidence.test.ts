import { describe, expect, it } from "vitest";
import {
  resolvePublicationEvidence,
  type PublicationAccessEvidence,
} from "../src/modules/issue-media/publication-evidence.js";
import type { PublicationReadinessInput } from "../src/modules/issue-media/publication-readiness.js";
import { ISSUE_MEDIA_RULE_POLICY_VERSION } from "../src/modules/issue-media/upload-gate-policy.js";
import { TRUSTED_IMAGE_UPLOADER_POLICY_VERSION } from "../src/modules/issue-media/trusted-uploader-policy.js";
import { LOCAL_SCAN_VERSION } from "../src/modules/issue-media/local-scan-contract.js";
import { EMBEDDED_TEXT_VERSION } from "../src/modules/issue-media/embedded-text.js";
import { MODERATION_PROVIDER_INPUT_VERSION } from "../src/modules/moderation-providers/contracts.js";
import {
  OPENAI_IMAGE_LABELS,
  OPENAI_TEXT_LABELS,
} from "../src/modules/moderation-providers/openai-coverage.js";
import { moderationDecisionRuntime } from "../src/modules/moderation/decision-runtime.js";
import { PROVISIONAL_REQUIRED_CHECKS } from "../src/modules/moderation/provisional-evidence.js";
import { MODERATION_POLICY_VERSION } from "../src/modules/moderation-dispatch/contracts.js";

function fixture() {
  const now = new Date("2026-08-30T00:00:00Z");
  const assets = ["a", "b"].map((id, index) => ({
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
  const snapshot: PublicationReadinessInput = {
    evaluatedAt: now,
    inputHash: "a".repeat(64),
    targetVersion: 1,
    runStatus: "SUCCEEDED",
    runMode: "SHADOW",
    runPolicyVersion: MODERATION_POLICY_VERSION,
    submission: {
      id: "submission",
      memberId: "member",
      revision: 1,
      contentHash: "a".repeat(64),
      status: "PENDING",
      publishedIssueId: null,
      mediaAssetAId: "a",
      mediaAssetBId: "b",
    },
    assets,
    knownBlockedHashes: new Set(),
    findings: assets.flatMap((asset) =>
      [
        "MEDIA_SOURCE_SIGNATURE_DECODE_VERIFIED",
        "MEDIA_NORMALIZED_WEBP_READY",
        "MEDIA_HASHES_COMPUTED",
        "MEDIA_ROUTE_REVIEW_REQUIRED",
      ].map((code) => ({
        id: `${asset.id}:${code}`,
        createdAt: new Date(now.getTime() - 1000),
        mediaAssetId: asset.id,
        code,
        stage: code.startsWith("MEDIA_ROUTE")
          ? "ROUTING"
          : code === "MEDIA_HASHES_COMPUTED"
            ? "HASH"
            : "NORMALIZATION",
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
      modelSnapshot: "omni-moderation-2024-09-26",
      modality: "TEXT_AND_IMAGE",
      supportedLabels: [],
      unsupportedLabels: [],
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
      signals: OPENAI_TEXT_LABELS.map((providerLabel) => ({
        providerLabel,
        canonicalCode: "TEST_ONLY",
        rawScore: 0.0001,
        calibratedBand: "LOW",
        flagged: false,
        regions: [],
        appliedModalities: OPENAI_IMAGE_LABELS.some((label) => label === providerLabel)
          ? ["TEXT", "IMAGE"]
          : ["TEXT"],
      })),
      embeddedText: {
        version: EMBEDDED_TEXT_VERSION,
        images: assets.map((asset) => ({
          normalizedHash: asset.normalizedHash,
          status: "COMPLETE",
          characters: 0,
        })),
      },
    },
  };
  const access: PublicationAccessEvidence = {
    member: { id: "member", status: "ACTIVE" },
    requiredConsentVersion: "which-media-consent-v1",
    capability: {
      id: "capability",
      memberId: "member",
      state: "ACTIVE",
      policyVersion: TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
      grantedAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 60000),
    },
    consent: {
      id: "consent",
      memberId: "member",
      consentVersion: "which-media-consent-v1",
      acceptedAt: new Date(now.getTime() - 1000),
      revokedAt: null,
    },
  };
  return { snapshot, access, runtime: moderationDecisionRuntime({}) };
}
type Fixture = ReturnType<typeof fixture>;

describe("internal publication evidence resolver", () => {
  it("assembles all nine checks from current sources without granting clear evidence", () => {
    const f = fixture();
    const result = resolvePublicationEvidence(f);
    expect(result.checks.map((c) => c.check)).toEqual([...PROVISIONAL_REQUIRED_CHECKS]);
    expect(result.checks.filter((c) => c.status === "PASS").map((c) => c.check)).toEqual([
      "TECHNICAL",
      "KNOWN_BLOCK",
      "LOCAL_PII",
      "RIGHTS",
      "CAPABILITY",
      "CONSENT",
    ]);
    expect(result.checks.filter((c) => c.status === "UNAVAILABLE").map((c) => c.check)).toEqual([
      "LOCAL_VISUAL",
      "IMAGE_SAFETY",
      "CONTEXT_SAFETY",
    ]);
    expect(result.decision).toMatchObject({ action: "PRIVATE_PENDING", outcome: "REVIEW" });
    expect(result.executionAuthorized).toBe(false);
    const capability = result.checks.find((c) => c.check === "CAPABILITY")!;
    expect(capability.validUntil).toBe(f.access.capability!.expiresAt.toISOString());
    expect(new Set(result.checks.map((c) => c.evidenceId)).size).toBe(9);
  });

  it.each([
    [
      "missing capability",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability = null;
      },
    ],
    [
      "revoked capability",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.state = "REVOKED";
      },
    ],
    [
      "suspended capability",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.state = "SUSPENDED";
      },
    ],
    [
      "expired capability",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.expiresAt = f.snapshot.evaluatedAt;
      },
    ],
    [
      "future grant",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.grantedAt = new Date("2030-01-01");
      },
    ],
    [
      "invalid grant time",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.expiresAt = new Date(NaN);
      },
    ],
    [
      "old capability policy",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.policyVersion = "old";
      },
    ],
    [
      "wrong grantee",
      "CAPABILITY",
      (f: Fixture) => {
        f.access.capability!.memberId = "other";
      },
    ],
    [
      "missing consent",
      "CONSENT",
      (f: Fixture) => {
        f.access.consent = null;
      },
    ],
    [
      "revoked consent",
      "CONSENT",
      (f: Fixture) => {
        f.access.consent!.revokedAt = f.snapshot.evaluatedAt;
      },
    ],
    [
      "new consent required",
      "CONSENT",
      (f: Fixture) => {
        f.access.requiredConsentVersion = "v2";
      },
    ],
    [
      "future consent",
      "CONSENT",
      (f: Fixture) => {
        f.access.consent!.acceptedAt = new Date("2030-01-01");
      },
    ],
    [
      "wrong consenter",
      "CONSENT",
      (f: Fixture) => {
        f.access.consent!.memberId = "other";
      },
    ],
    [
      "missing technical source",
      "TECHNICAL",
      (f: Fixture) => {
        f.snapshot.findings[0]!.id = undefined;
      },
    ],
    [
      "future technical source",
      "TECHNICAL",
      (f: Fixture) => {
        f.snapshot.findings[0]!.createdAt = new Date("2030-01-01");
      },
    ],
    [
      "duplicate technical source",
      "TECHNICAL",
      (f: Fixture) => {
        f.snapshot.findings = [...f.snapshot.findings, f.snapshot.findings[0]!];
      },
    ],
    [
      "wrong finding stage",
      "TECHNICAL",
      (f: Fixture) => {
        f.snapshot.findings[0]!.stage = "PROVIDER_SHADOW";
      },
    ],
    [
      "old image hash",
      "TECHNICAL",
      (f: Fixture) => {
        f.snapshot.findings[0]!.evidence.normalizedSha256 = "f".repeat(64);
      },
    ],
    [
      "new block hash",
      "KNOWN_BLOCK",
      (f: Fixture) => {
        f.snapshot.knownBlockedHashes = new Set([f.snapshot.assets[1]!.normalizedHash!]);
      },
    ],
    [
      "withdrawn rights",
      "RIGHTS",
      (f: Fixture) => {
        f.snapshot.assets[1]!.rightsState = "WITHDRAWN";
      },
    ],
    [
      "disabled rules",
      "LOCAL_PII",
      (f: Fixture) => {
        f.snapshot.findings[3]!.evidence.ruleGateMode = "OFF";
      },
    ],
    [
      "missing local source",
      "LOCAL_PII",
      (f: Fixture) => {
        f.snapshot.findings[3]!.id = undefined;
      },
    ],
    [
      "unknown detector",
      "LOCAL_PII",
      (f: Fixture) => {
        f.snapshot.findings[3]!.evidence.detectorVersion = "unknown";
      },
    ],
    [
      "OCR timeout",
      "LOCAL_PII",
      (f: Fixture) => {
        f.snapshot.findings[3]!.evidence.scanFailureCode = "TIMEOUT";
      },
    ],
    [
      "PII finding",
      "LOCAL_PII",
      (f: Fixture) => {
        f.snapshot.findings = [
          ...f.snapshot.findings,
          {
            ...f.snapshot.findings[3]!,
            code: "MEDIA_OCR_PII_DETECTED",
            stage: "LOCAL_RULES",
            severity: "REVIEW",
          },
        ];
      },
    ],
  ] as const)("does not pass %s", (_name, check, mutate) => {
    const f = fixture();
    mutate(f);
    const result = resolvePublicationEvidence(f);
    expect(result.checks.find((c) => c.check === check)?.status).not.toBe("PASS");
    expect(result.executionAuthorized).toBe(false);
  });

  it.each([
    (f: Fixture) => {
      f.access.member!.status = "SUSPENDED";
    },
    (f: Fixture) => {
      f.access.member!.id = "other";
    },
    (f: Fixture) => {
      f.snapshot.submission!.revision++;
    },
    (f: Fixture) => {
      f.snapshot.submission!.status = "CANCELLED";
    },
    (f: Fixture) => {
      f.snapshot.submission!.publishedIssueId = "published";
    },
    (f: Fixture) => {
      f.snapshot.assets[1]!.storageState = "QUARANTINED";
    },
    (f: Fixture) => {
      f.snapshot.runPolicyVersion = "old";
    },
  ])("invalidates all checks when the current submission/access binding changes (%#)", (mutate) => {
    const f = fixture();
    mutate(f);
    expect(resolvePublicationEvidence(f).checks.every((c) => c.status !== "PASS")).toBe(true);
  });

  it("ignores supplied clear proofs and a forged complete visual field even with all runtime flags on", () => {
    const f = fixture();
    f.runtime = {
      ...f.runtime,
      mode: "LIMITED_ACTION",
      killSwitch: false,
      canaryPercent: 100,
      categoryFlags: { ISSUE_MEDIA: true },
      provisionalReleaseApproved: true,
      provisionalCohorts: ["TRUSTED"],
      provisionalAssetTypes: ["ISSUE_MEDIA"],
    };
    f.snapshot.providerResult.provisionalEvidence = {
      checks: PROVISIONAL_REQUIRED_CHECKS.map((check) => ({ check, status: "PASS" })),
    };
    f.snapshot.providerResult.clearScore = 1;
    f.snapshot.providerResult.publicationReadiness = { executionAuthorized: true };
    f.snapshot.providerResult.rawOcrText = "secret@example.test";
    f.snapshot.findings[3]!.evidence.scanStatus = {
      qr: "COMPLETE",
      barcode: "COMPLETE",
      ocr: "COMPLETE",
      visual: "COMPLETE",
    };
    const result = resolvePublicationEvidence(f);
    expect(result.decision.outcome).toBe("REVIEW");
    expect(result.decision.rejectionCodes).toContain("MISSING_SIGNAL");
    expect(result.decision.rejectionCodes).toContain("INVALID_PUBLICATION_EVIDENCE");
    expect(result.checks.find((c) => c.check === "LOCAL_VISUAL")?.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("secret@example.test");
    expect(JSON.stringify(result)).not.toContain("clearScore");
    expect(result.executionAuthorized).toBe(false);
  });
});
