import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import type {
  ModerationProviderCallError,
  NormalizedModerationProviderResult,
} from "../src/modules/moderation-providers/contracts.js";
import {
  compareModerationProviders,
  detectModerationDrift,
  toGoldenSetPrediction,
} from "../src/modules/moderation-providers/evaluation.js";
import {
  normalizeProviderImage,
  redactProviderContext,
} from "../src/modules/moderation-providers/input-resolver.js";
import { createOpenAiModerationAdapter } from "../src/modules/moderation-providers/openai-moderation-adapter.js";
import {
  moderationProviderRuntimeConfig,
  evaluateModerationRuntimeGate,
  providerRuntimeDiagnostic,
} from "../src/modules/moderation-providers/runtime-gate.js";

const target = {
  targetType: "COMMENT_VERSION" as const,
  targetId: "8fd72bc6-e431-49cb-b918-b4497563d7f5",
  targetVersion: 1,
  privateObjectReference: "comment://version/8fd72bc6-e431-49cb-b918-b4497563d7f5/1",
  normalizedInputHash: "a".repeat(64),
  policyVersion: "moderation-shadow-v1",
};

function providerResponse(status = 200) {
  return new Response(
    JSON.stringify({
      id: "modr_test",
      model: "omni-moderation-2024-09-26",
      results: [
        {
          flagged: true,
          categories: { harassment: true, sexual: false },
          category_scores: { harassment: 0.91, sexual: 0.02 },
          category_applied_input_types: { harassment: ["text"], sexual: ["text", "image"] },
        },
      ],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("OpenAI moderation Shadow adapter", () => {
  it("normalizes provider labels without treating unsupported policy areas as safe", async () => {
    let capturedBody: string | null = null;
    const fetchImpl: typeof fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : null;
      return Promise.resolve(providerResponse());
    });
    const adapter = createOpenAiModerationAdapter({
      apiKey: "test-key",
      fetchImpl,
      resolveInput: () =>
        Promise.resolve({ targetType: "COMMENT_VERSION", modality: "TEXT", text: "test" }),
    });

    const result = await adapter.inspect(target);
    expect(result).toMatchObject({ status: "SUCCEEDED", costMicros: 0 });
    const normalized = result.result as NormalizedModerationProviderResult;
    expect(normalized).toMatchObject({
      modelSnapshot: "omni-moderation-2024-09-26",
      publicationChanged: false,
      capabilities: { boundingBoxes: false },
    });
    expect(normalized.unsupportedLabels).toContain("PERSONAL_INFORMATION");
    expect(normalized.unsupportedLabels).toContain("COPYRIGHT_OR_RIGHTS");
    expect(normalized.signals.find(({ providerLabel }) => providerLabel === "harassment")).toEqual({
      providerLabel: "harassment",
      canonicalCode: "INSULT_OR_HARASSMENT",
      rawScore: 0.91,
      calibratedBand: "CRITICAL",
      flagged: true,
      appliedModalities: ["TEXT"],
      regions: [],
    });
    expect(capturedBody).toBe(
      JSON.stringify({
        model: "omni-moderation-2024-09-26",
        input: [{ type: "text", text: "test" }],
      }),
    );
  });

  it.each([
    [429, "RATE_LIMITED", true],
    [401, "AUTHENTICATION", false],
    [500, "PROVIDER_UNAVAILABLE", true],
    [400, "REFUSAL", false],
  ] as const)("classifies HTTP %s failures", async (status, kind, retryable) => {
    const adapter = createOpenAiModerationAdapter({
      apiKey: "test-key",
      fetchImpl: () => Promise.resolve(providerResponse(status)),
      resolveInput: () =>
        Promise.resolve({ targetType: "COMMENT_VERSION", modality: "TEXT", text: "test" }),
    });
    await expect(adapter.inspect(target)).rejects.toMatchObject({
      kind,
      retryable,
      httpStatus: status,
    });
  });

  it("classifies malformed output and stores no raw provider body", async () => {
    const adapter = createOpenAiModerationAdapter({
      apiKey: "test-key",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ unexpected: "secret" }))),
      resolveInput: () =>
        Promise.resolve({ targetType: "COMMENT_VERSION", modality: "TEXT", text: "test" }),
    });
    await expect(adapter.inspect(target)).rejects.toEqual(
      expect.objectContaining<Partial<ModerationProviderCallError>>({
        kind: "MALFORMED_OUTPUT",
        code: "INVALID_RESPONSE_SCHEMA",
      }),
    );
  });
});

describe("moderation provider privacy controls", () => {
  it("redacts direct contact data before provider context is built", () => {
    expect(redactProviderContext("skyho@example.com https://whichone.site 010-1234-5678")).toBe(
      "[EMAIL_REDACTED] [URL_REDACTED] [PHONE_REDACTED]",
    );
  });

  it("re-encodes provider images as metadata-free WebP within 1024px", async () => {
    const source = await sharp({
      create: { width: 2_048, height: 1_280, channels: 3, background: "#12bfd0" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const derivative = await normalizeProviderImage(source);
    const metadata = await sharp(derivative.data).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(1_024);
    expect(metadata.exif).toBeUndefined();
  });

  it("defaults to a disabled, killed, zero-canary provider configuration", () => {
    const config = moderationProviderRuntimeConfig({});
    expect(providerRuntimeDiagnostic(config)).toMatchObject({
      mode: "OFF",
      provider: "NONE",
      killSwitch: true,
      canaryPercent: 0,
      apiKeyConfigured: false,
      privacyGateAllowed: false,
    });
  });

  it("requires all gates and enforces the daily call cap", () => {
    const evidence = [
      "dpaExecuted",
      "noTrainingConfirmed",
      "retentionTermsRecorded",
      "deletionTermsRecorded",
      "subprocessorsRecorded",
      "processingRegionRecorded",
      "encryptionConfirmed",
      "credentialRotationOwnerAssigned",
      "breachResponseRecorded",
      "internationalTransferLegalReviewApproved",
      "providerDataControlApproved",
    ].join(",");
    const config = moderationProviderRuntimeConfig({
      MODERATION_PROVIDER_MODE: "SHADOW",
      MODERATION_PROVIDER: "OPENAI_MODERATION",
      MODERATION_PROVIDER_KILL_SWITCH: "false",
      MODERATION_PROVIDER_CANARY_PERCENT: "100",
      MODERATION_PROVIDER_DAILY_CALL_CAP: "10",
      MODERATION_PROVIDER_APPROVAL_EVIDENCE: evidence,
      OPENAI_API_KEY: "configured-test-key",
    });
    expect(
      evaluateModerationRuntimeGate({
        config,
        normalizedInputHash: "0".repeat(64),
        callsToday: 9,
      }),
    ).toEqual({ allowed: true, reason: "SHADOW_CANARY_ALLOWED" });
    expect(
      evaluateModerationRuntimeGate({
        config,
        normalizedInputHash: "0".repeat(64),
        callsToday: 10,
      }),
    ).toEqual({ allowed: false, reason: "DAILY_CALL_CAP_REACHED" });
  });
});

describe("Shadow evaluation bridge", () => {
  const result = {
    schemaVersion: 1 as const,
    provider: "OPENAI_MODERATION",
    modality: "TEXT" as const,
    modelSnapshot: "omni-moderation-2024-09-26",
    supportedLabels: ["HATE"],
    unsupportedLabels: ["PRIVACY_PII_DETECTED"],
    signals: [
      {
        providerLabel: "hate",
        canonicalCode: "HATE",
        rawScore: 0.82,
        calibratedBand: "HIGH" as const,
        flagged: true,
        appliedModalities: ["TEXT" as const],
        regions: [],
      },
    ],
    abstained: false,
    providerDisagreement: null,
    capabilities: { boundingBoxes: false },
    publicationChanged: false as const,
  };

  it("converts normalized results for the existing Golden Set evaluator", () => {
    expect(
      toGoldenSetPrediction({ caseId: "text-hate-001", result, latencyMs: 12, costMicros: 0 }),
    ).toMatchObject({
      predictedAction: "REVIEW",
      reasonCodes: ["HATE"],
      abstained: false,
      confidence: 0.82,
    });
  });

  it("records cross-provider disagreement explicitly", () => {
    const comparison = compareModerationProviders(result, {
      ...result,
      provider: "SECOND_PROVIDER",
      signals: [],
    });
    expect(comparison).toEqual({ disagreed: true, leftFlags: ["HATE"], rightFlags: [] });
  });

  it("stops promotion when the pinned snapshot changes or score distribution drifts", () => {
    expect(
      detectModerationDrift({
        baseline: {
          modelSnapshot: "omni-moderation-2024-09-26",
          sampleSize: 1_000,
          flaggedRate: 0.08,
          meanMaxScore: 0.19,
        },
        current: {
          modelSnapshot: "different-snapshot",
          sampleSize: 1_000,
          flaggedRate: 0.09,
          meanMaxScore: 0.2,
        },
      }),
    ).toMatchObject({ drifted: true, modelChanged: true });
  });
});
