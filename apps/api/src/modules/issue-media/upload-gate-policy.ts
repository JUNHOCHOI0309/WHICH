import { createHmac } from "node:crypto";

import type { RuleSignal } from "../moderation/rule-engine.js";

export const ISSUE_MEDIA_UPLOAD_POLICY_VERSION = "which-member-media-upload-v1";
export const ISSUE_MEDIA_UPLOAD_LIMITS = {
  sessionTtlSeconds: 600,
  maximumBytes: 10 * 1024 * 1024,
  dailySessionsPerMember: 3,
  dailySessionsPerIp: 12,
  maximumConcurrentSessions: 1,
  maximumOpenAssets: 10,
} as const;

export type IssueMediaUploadGateReason =
  | "MODE_DISABLED"
  | "CAPABILITY_REQUIRED"
  | "CONSENT_REQUIRED"
  | "SUBMISSION_OWNERSHIP_REQUIRED"
  | "SUBMISSION_STATE_INELIGIBLE"
  | "MEMBER_DAILY_LIMIT"
  | "IP_DAILY_LIMIT"
  | "CONCURRENT_SESSION_LIMIT"
  | "OPEN_ASSET_LIMIT";

export function evaluateIssueMediaUploadGate(input: {
  mode: "OFF" | "PILOT";
  hasActiveCapability: boolean;
  hasCurrentConsent: boolean;
  ownsSubmission: boolean;
  submissionStatus: string | null;
  memberSessionsToday: number;
  ipSessionsToday: number;
  activeSessions: number;
  openAssets: number;
}): { allowed: boolean; reasons: IssueMediaUploadGateReason[] } {
  const reasons: IssueMediaUploadGateReason[] = [];
  if (input.mode !== "PILOT") reasons.push("MODE_DISABLED");
  if (!input.hasActiveCapability) reasons.push("CAPABILITY_REQUIRED");
  if (!input.hasCurrentConsent) reasons.push("CONSENT_REQUIRED");
  if (!input.ownsSubmission) reasons.push("SUBMISSION_OWNERSHIP_REQUIRED");
  if (!input.submissionStatus || !["PENDING", "NEEDS_CHANGES"].includes(input.submissionStatus)) {
    reasons.push("SUBMISSION_STATE_INELIGIBLE");
  }
  if (input.memberSessionsToday >= ISSUE_MEDIA_UPLOAD_LIMITS.dailySessionsPerMember) {
    reasons.push("MEMBER_DAILY_LIMIT");
  }
  if (input.ipSessionsToday >= ISSUE_MEDIA_UPLOAD_LIMITS.dailySessionsPerIp) {
    reasons.push("IP_DAILY_LIMIT");
  }
  if (input.activeSessions >= ISSUE_MEDIA_UPLOAD_LIMITS.maximumConcurrentSessions) {
    reasons.push("CONCURRENT_SESSION_LIMIT");
  }
  if (input.openAssets >= ISSUE_MEDIA_UPLOAD_LIMITS.maximumOpenAssets) {
    reasons.push("OPEN_ASSET_LIMIT");
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
  if (input.qrDetected) add("MEDIA_QR_DETECTED", "REVIEW");
  if (input.barcodeDetected) add("MEDIA_BARCODE_DETECTED", "REVIEW");
  if (input.faceDetected) add("MEDIA_FACE_PRESENT", "REVIEW");
  if (input.identityDocumentDetected) add("MEDIA_IDENTITY_DOCUMENT_PRESENT", "REVIEW");
  if (input.screenshotDetected) add("MEDIA_SCREENSHOT_PRESENT", "REVIEW");
  if (input.ocrText) {
    const pii =
      /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?<!\d)01[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d))/iu;
    if (pii.test(input.ocrText)) add("MEDIA_OCR_PII_DETECTED", "REVIEW");
  }
  if (!input.inspectionComplete) add("MEDIA_INSPECTION_INCOMPLETE", "REVIEW");

  return {
    decision: signals.some((signal) => signal.severity === "BLOCK")
      ? "AUTO_REJECT_PRIVATE"
      : signals.some((signal) => signal.severity === "REVIEW")
        ? "REVIEW_REQUIRED"
        : "REVIEW_READY",
    signals,
  };
}
