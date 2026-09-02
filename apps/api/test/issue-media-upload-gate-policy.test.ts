import { describe, expect, it } from "vitest";

import {
  dHashDistance,
  evaluateIssueMediaUploadGate,
  evaluateLocalMediaInspection,
  uploadActorPseudonym,
} from "../src/modules/issue-media/upload-gate-policy.js";

const eligibleGate = {
  mode: "PILOT" as const,
  hasActiveCapability: true,
  hasActiveMember: true,
  accountRestricted: false,
  hasCurrentConsent: true,
  ownsSubmission: true,
  submissionStatus: "PENDING",
  activeSessions: 0,
};

describe("Member Issue media upload gate", () => {
  it("retains mode, capability, consent, ownership, and concurrent-session checks", () => {
    expect(evaluateIssueMediaUploadGate(eligibleGate)).toEqual({ allowed: true, reasons: [] });
    expect(
      evaluateIssueMediaUploadGate({
        ...eligibleGate,
        mode: "OFF",
        hasActiveCapability: false,
        hasCurrentConsent: false,
        ownsSubmission: false,
        activeSessions: 2,
      }),
    ).toMatchObject({
      allowed: false,
      reasons: [
        "MODE_DISABLED",
        "CONSENT_REQUIRED",
        "SUBMISSION_OWNERSHIP_REQUIRED",
        "CONCURRENT_SESSION_LIMIT",
      ],
    });
  });

  it("opens direct upload to an active Member without a Pilot capability", () => {
    expect(
      evaluateIssueMediaUploadGate({
        ...eligibleGate,
        mode: "MEMBER",
        hasActiveCapability: false,
      }),
    ).toEqual({ allowed: true, reasons: [] });
  });

  it("blocks a report-restricted account in Member mode", () => {
    expect(
      evaluateIssueMediaUploadGate({
        ...eligibleGate,
        mode: "MEMBER",
        accountRestricted: true,
      }),
    ).toEqual({ allowed: false, reasons: ["ACCOUNT_RESTRICTED"] });
  });

  it.each([null, "CANCELLED", "APPROVED", "REJECTED"])(
    "still rejects uploads for an ineligible submission (%s)",
    (submissionStatus) => {
      expect(evaluateIssueMediaUploadGate({ ...eligibleGate, submissionStatus })).toEqual({
        allowed: false,
        reasons: ["SUBMISSION_STATE_INELIGIBLE"],
      });
    },
  );

  it("pseudonymizes Member and IP buckets without retaining raw identifiers", () => {
    const member = uploadActorPseudonym("member", "member-id", "secret-secret-secret");
    const ip = uploadActorPseudonym("ip", "203.0.113.10", "secret-secret-secret");
    expect(member).toMatch(/^[a-f0-9]{64}$/);
    expect(ip).toMatch(/^[a-f0-9]{64}$/);
    expect(member).not.toBe(ip);
  });

  it("auto-rejects only exact known blocks and routes similarity or partial inspection to review", () => {
    const blocked = evaluateLocalMediaInspection({
      sha256: "a".repeat(64),
      perceptualHash: "0".repeat(16),
      knownBlockedSha256: new Set(["a".repeat(64)]),
      inspectionComplete: true,
    });
    expect(blocked.decision).toBe("AUTO_REJECT_PRIVATE");

    const review = evaluateLocalMediaInspection({
      sha256: "b".repeat(64),
      perceptualHash: "0000000000000000",
      similarPerceptualHashes: ["0000000000000001"],
      qrDetected: true,
      ocrText: "연락처 010-1234-5678",
      inspectionComplete: false,
    });
    expect(review.decision).toBe("REVIEW_REQUIRED");
    expect(review.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "MEDIA_PERCEPTUAL_SIMILARITY",
        "MEDIA_QR_DETECTED",
        "MEDIA_OCR_PII_DETECTED",
        "MEDIA_INSPECTION_INCOMPLETE",
      ]),
    );
    expect(dHashDistance("0000000000000000", "0000000000000001")).toBe(1);
  });

  it("turns detector results into review findings without retaining raw OCR text", () => {
    const review = evaluateLocalMediaInspection({
      sha256: "c".repeat(64),
      perceptualHash: "f".repeat(16),
      detector: {
        detectorVersion: "test-local-detector-v1",
        qr: { status: "COMPLETE", detected: true },
        barcode: { status: "COMPLETE", detected: false },
        ocr: { status: "COMPLETE", text: "contact tester@example.com" },
        visual: {
          status: "PARTIAL",
          faceDetected: true,
          identityDocumentDetected: false,
          screenshotDetected: false,
        },
      },
      inspectionComplete: false,
    });

    expect(review.decision).toBe("REVIEW_REQUIRED");
    expect(review.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "MEDIA_QR_DETECTED",
        "MEDIA_FACE_PRESENT",
        "MEDIA_OCR_PII_DETECTED",
        "MEDIA_VISUAL_SCAN_INCOMPLETE",
      ]),
    );
    expect(JSON.stringify(review.signals)).not.toContain("tester@example.com");
  });
});
