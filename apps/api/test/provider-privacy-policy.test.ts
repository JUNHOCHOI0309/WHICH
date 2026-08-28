import { describe, expect, it } from "vitest";

import { RETENTION_PRECEDENCE } from "../src/modules/content-revisions/service.js";
import {
  FACE_PROCESSING_BOUNDARY,
  IMAGE_MODERATION_PROVIDER_REGISTRY,
  IMAGE_MODERATION_RETENTION,
  IMAGE_PROVIDER_PRIVACY_POLICY,
  RETENTION_OVERRIDE_PRECEDENCE,
  assertNoProhibitedExternalFields,
  buildExternalImageModerationEnvelope,
  evaluateImageProviderGate,
  sanitizeProviderFailure,
  type ProviderGateEvidence,
} from "../src/modules/moderation/provider-privacy-policy.js";

const completeEvidence: ProviderGateEvidence = {
  dpaExecuted: true,
  noTrainingConfirmed: true,
  retentionTermsRecorded: true,
  deletionTermsRecorded: true,
  subprocessorsRecorded: true,
  processingRegionRecorded: true,
  encryptionConfirmed: true,
  credentialRotationOwnerAssigned: true,
  breachResponseRecorded: true,
  internationalTransferLegalReviewApproved: true,
  providerDataControlApproved: true,
};

describe("image provider privacy gate", () => {
  it("defaults external providers to OFF and requires every contract control", () => {
    expect(IMAGE_PROVIDER_PRIVACY_POLICY.defaultMode).toBe("OFF");
    expect(
      evaluateImageProviderGate({
        mode: "OFF",
        provider: "OPENAI_MODERATION",
        evidence: completeEvidence,
      }),
    ).toMatchObject({ allowed: false, reason: "PROVIDER_MODE_OFF" });
    expect(
      evaluateImageProviderGate({
        mode: "SHADOW",
        provider: "OPENAI_MODERATION",
        evidence: { ...completeEvidence, dpaExecuted: false },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "PROVIDER_EVIDENCE_INCOMPLETE",
      missingEvidence: ["dpaExecuted"],
    });
    expect(
      evaluateImageProviderGate({
        mode: "SHADOW",
        provider: "OPENAI_MODERATION",
        evidence: completeEvidence,
      }),
    ).toMatchObject({ allowed: true, reason: "PROVIDER_GATE_SATISFIED" });
  });

  it("rejects direct and nested personal or behavioral identifiers", () => {
    for (const payload of [
      { raw_ip: "127.0.0.1" },
      { user: { deviceID: "device" } },
      { records: [{ oauth_subject: "provider-user" }] },
      { context: { email: "member@example.com" } },
      { vote_choice: "A" },
      { member_id: "internal-member" },
    ]) {
      expect(() => assertNoProhibitedExternalFields(payload)).toThrow(/Prohibited provider field/);
    }
  });

  it("builds only a minimized normalized WebP envelope", () => {
    const envelope = buildExternalImageModerationEnvelope({
      provider: "OPENAI_MODERATION",
      opaqueRequestId: "opaque_request_123456789",
      derivative: {
        mimeType: "image/webp",
        width: 1_024,
        height: 768,
        byteLength: 42,
        metadataStripped: true,
        reencoded: true,
        content: "normalized-image-data",
      },
      context: {
        question: "어느 쪽이 더 편한가요?",
        choices: ["A", "B"],
        altText: "비식별 장면",
        piiRedacted: true,
      },
    });

    expect(envelope.policy.version).toBe("1.0.0");
    expect(envelope.media.mimeType).toBe("image/webp");
    expect(JSON.stringify(envelope)).not.toMatch(/email|memberId|guestId|voteChoice|rawIp/i);
    expect(() =>
      buildExternalImageModerationEnvelope({
        ...envelope,
        derivative: { ...envelope.media, width: 1_025 },
      }),
    ).toThrow(/dimensions/);
  });

  it("pins numeric TTLs and the existing deletion/hold precedence", () => {
    for (const policy of Object.values(IMAGE_MODERATION_RETENTION)) {
      expect(Number.isInteger(policy.ttlDays)).toBe(true);
      expect(Number.isInteger(policy.purgeWithinHours)).toBe(true);
    }
    expect(IMAGE_MODERATION_RETENTION.RAW_UPLOAD).toMatchObject({
      ttlDays: 0,
      purgeWithinHours: 1,
    });
    expect(IMAGE_MODERATION_RETENTION.LEGAL_HOLD).toMatchObject({
      ttlDays: 0,
      purgeWithinHours: 720,
    });
    expect(RETENTION_OVERRIDE_PRECEDENCE).toEqual(RETENTION_PRECEDENCE);
    expect(RETENTION_OVERRIDE_PRECEDENCE.LEGAL_HOLD).toBeGreaterThan(
      RETENTION_OVERRIDE_PRECEDENCE.RIGHTS,
    );
  });

  it("prohibits biometric or identity inference and keeps providers conditional", () => {
    expect(FACE_PROCESSING_BOUNDARY.allowed).toEqual(["FACE_PRESENCE_ROUTING"]);
    expect(FACE_PROCESSING_BOUNDARY.prohibited).toEqual(
      expect.arrayContaining([
        "FACE_RECOGNITION",
        "IDENTITY_INFERENCE",
        "MINOR_OR_AGE_INFERENCE",
        "BIOMETRIC_EMBEDDING",
      ]),
    );
    expect(IMAGE_MODERATION_PROVIDER_REGISTRY.OPENAI_MODERATION.approval).toBe("CONDITIONAL");
    expect(IMAGE_MODERATION_PROVIDER_REGISTRY.GOOGLE_CLOUD_VISION.approval).toBe("CONDITIONAL");
  });

  it("stores only bounded operational failure metadata", () => {
    const sanitized = sanitizeProviderFailure({
      provider: "OPENAI_MODERATION",
      stage: "PROVIDER_REQUEST",
      errorCode: "upstream failed: user@example.com",
      httpStatus: 503,
      retryable: true,
    });
    expect(sanitized).toEqual({
      provider: "OPENAI_MODERATION",
      stage: "PROVIDER_REQUEST",
      errorCode: "UNCLASSIFIED_PROVIDER_ERROR",
      httpStatus: 503,
      retryable: true,
    });
    expect(sanitized).not.toHaveProperty("message");
    expect(sanitized).not.toHaveProperty("response");
    expect(sanitized).not.toHaveProperty("input");
  });
});
