import { createHmac } from "node:crypto";

import type { RuleSignal } from "../moderation/rule-engine.js";
import { detectOcrPiiKinds, type OcrPiiKind } from "./ocr-pii.js";
import type { LocalScanFailure } from "./local-scan-contract.js";

export const ISSUE_MEDIA_UPLOAD_POLICY_VERSION = "which-member-media-upload-v1";
export const ISSUE_MEDIA_RULE_POLICY_VERSION = "which-issue-media-rules-v1";
export type IssueMediaRuleGateMode = "OFF" | "SHADOW" | "ENFORCE";
export type LocalMediaScanStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

export type LocalMediaSignalDetectorResult = {
  detectorVersion: string;
  failureCode?: LocalScanFailure;
  qr: { status: LocalMediaScanStatus; detected: boolean };
  barcode: { status: LocalMediaScanStatus; detected: boolean };
  ocr: { status: LocalMediaScanStatus; text?: string; piiKinds?: OcrPiiKind[] };
  visual: {
    status: LocalMediaScanStatus;
    faceDetected: boolean;
    identityDocumentDetected: boolean;
    screenshotDetected: boolean;
  };
};

export interface LocalMediaSignalDetector {
  inspect(normalizedWebp: Buffer): Promise<LocalMediaSignalDetectorResult>;
}

export const unavailableLocalMediaSignalDetector: LocalMediaSignalDetector = {
  inspect: () =>
    Promise.resolve({
      detectorVersion: "which-local-signal-unavailable-v1",
      qr: { status: "UNAVAILABLE", detected: false },
      barcode: { status: "UNAVAILABLE", detected: false },
      ocr: { status: "UNAVAILABLE" },
      visual: {
        status: "UNAVAILABLE",
        faceDetected: false,
        identityDocumentDetected: false,
        screenshotDetected: false,
      },
    }),
};
export const ISSUE_MEDIA_UPLOAD_LIMITS = {
  sessionTtlSeconds: 600,
  maximumBytes: 10 * 1024 * 1024,
  maximumConcurrentSessions: 1,
} as const;

export type IssueMediaUploadGateReason =
  | "MODE_DISABLED"
  | "CAPABILITY_REQUIRED"
  | "CONSENT_REQUIRED"
  | "SUBMISSION_OWNERSHIP_REQUIRED"
  | "SUBMISSION_STATE_INELIGIBLE"
  | "CONCURRENT_SESSION_LIMIT"
  | "MODERATION_CAPACITY_PAUSED";

export function evaluateIssueMediaUploadGate(input: {
  mode: "OFF" | "PILOT";
  hasActiveCapability: boolean;
  hasCurrentConsent: boolean;
  ownsSubmission: boolean;
  submissionStatus: string | null;
  activeSessions: number;
}): { allowed: boolean; reasons: IssueMediaUploadGateReason[] } {
  const reasons: IssueMediaUploadGateReason[] = [];
  if (input.mode !== "PILOT") reasons.push("MODE_DISABLED");
  if (!input.hasActiveCapability) reasons.push("CAPABILITY_REQUIRED");
  if (!input.hasCurrentConsent) reasons.push("CONSENT_REQUIRED");
  if (!input.ownsSubmission) reasons.push("SUBMISSION_OWNERSHIP_REQUIRED");
  if (!input.submissionStatus || !["PENDING", "NEEDS_CHANGES"].includes(input.submissionStatus)) {
    reasons.push("SUBMISSION_STATE_INELIGIBLE");
  }
  if (input.activeSessions >= ISSUE_MEDIA_UPLOAD_LIMITS.maximumConcurrentSessions) {
    reasons.push("CONCURRENT_SESSION_LIMIT");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function uploadActorPseudonym(kind: "member" | "ip", value: string, secret: string) {
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

export type LocalMediaInspection = {
  sha256: string;
  perceptualHash: string;
  knownBlockedSha256?: ReadonlySet<string>;
  similarPerceptualHashes?: readonly string[];
  qrDetected?: boolean;
  barcodeDetected?: boolean;
  ocrText?: string;
  faceDetected?: boolean;
  identityDocumentDetected?: boolean;
  screenshotDetected?: boolean;
  detector?: LocalMediaSignalDetectorResult;
  inspectionComplete: boolean;
};

function bitCount(value: bigint) {
  let bits = value;
  let count = 0;
  while (bits) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}

export function dHashDistance(left: string, right: string) {
  if (!/^[a-f0-9]{16}$/iu.test(left) || !/^[a-f0-9]{16}$/iu.test(right)) return null;
  return bitCount(BigInt(`0x${left}`) ^ BigInt(`0x${right}`));
}

export function evaluateLocalMediaInspection(input: LocalMediaInspection): {
  decision: "AUTO_REJECT_PRIVATE" | "REVIEW_REQUIRED" | "REVIEW_READY";
  signals: RuleSignal[];
} {
  const signals: RuleSignal[] = [];
  const add = (code: string, severity: RuleSignal["severity"], metadata?: RuleSignal["metadata"]) =>
    signals.push({
      code,
      severity,
      ruleVersion: "which-common-rules-v1",
      ...(metadata ? { metadata } : {}),
    });
  if (input.knownBlockedSha256?.has(input.sha256)) {
    add("MEDIA_KNOWN_BLOCK_EXACT_HASH", "BLOCK");
  }
  const distance = input.similarPerceptualHashes
    ?.map((candidate) => dHashDistance(input.perceptualHash, candidate))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0];
  if (distance !== undefined && distance <= 8) {
    add("MEDIA_PERCEPTUAL_SIMILARITY", "REVIEW", { distance });
  }
  const detector = input.detector;
  const qrDetected = detector?.qr.detected ?? input.qrDetected;
  const barcodeDetected = detector?.barcode.detected ?? input.barcodeDetected;
  const faceDetected = detector?.visual.faceDetected ?? input.faceDetected;
  const identityDocumentDetected =
    detector?.visual.identityDocumentDetected ?? input.identityDocumentDetected;
  const screenshotDetected = detector?.visual.screenshotDetected ?? input.screenshotDetected;
  const ocrText = detector?.ocr.text ?? input.ocrText;
  if (qrDetected) add("MEDIA_QR_DETECTED", "REVIEW");
  if (barcodeDetected) add("MEDIA_BARCODE_DETECTED", "REVIEW");
  if (faceDetected) add("MEDIA_FACE_PRESENT", "REVIEW");
  if (identityDocumentDetected) add("MEDIA_IDENTITY_DOCUMENT_PRESENT", "REVIEW");
  if (screenshotDetected) add("MEDIA_SCREENSHOT_PRESENT", "REVIEW");
  if (ocrText || detector?.ocr.piiKinds?.length) {
    const kinds = [
      ...new Set([
        ...(ocrText ? detectOcrPiiKinds(ocrText) : []),
        ...(detector?.ocr.piiKinds ?? []),
      ]),
    ];
    if (kinds.length) add("MEDIA_OCR_PII_DETECTED", "REVIEW", { kinds: kinds.join(",") });
  }
  if (detector) {
    for (const [scan, status] of [
      ["QR", detector.qr.status],
      ["BARCODE", detector.barcode.status],
      ["OCR", detector.ocr.status],
      ["VISUAL", detector.visual.status],
    ] as const) {
      if (status !== "COMPLETE") {
        add(`MEDIA_${scan}_SCAN_INCOMPLETE`, "REVIEW", { status });
      }
    }
  }
  if (!input.inspectionComplete && !detector) add("MEDIA_INSPECTION_INCOMPLETE", "REVIEW");

  return {
    decision: signals.some((signal) => signal.severity === "BLOCK")
      ? "AUTO_REJECT_PRIVATE"
      : signals.some((signal) => signal.severity === "REVIEW")
        ? "REVIEW_REQUIRED"
        : "REVIEW_READY",
    signals,
  };
}
