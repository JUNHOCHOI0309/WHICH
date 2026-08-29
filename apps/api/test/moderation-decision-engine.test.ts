import { describe, expect, it } from "vitest";

import {
  MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
  findModerationDecisionThreshold,
} from "../src/modules/moderation/decision-threshold-registry.js";
import {
  MODERATION_DOMAIN_ACTION_MAP,
  evaluateModerationDecision,
  rollbackModerationDecision,
  type ModerationDecisionRequest,
  type ModerationDecisionRuntime,
} from "../src/modules/moderation/decision-engine.js";
import { moderationDecisionRuntime } from "../src/modules/moderation/decision-runtime.js";

const activeRuntime: ModerationDecisionRuntime = {
  mode: "LIMITED_ACTION",
  killSwitch: false,
  canaryPercent: 100,
  categoryFlags: { ISSUE_MEDIA: true, COMMENT: true },
  operationalBudgetHealthy: true,
  provisionalReleaseApproved: false,
  provisionalCohorts: [],
  provisionalAssetTypes: [],
  quarantineTtlSeconds: 86_400,
  provisionalTtlSeconds: 21_600,
};

const baseRequest: ModerationDecisionRequest = {
  policyVersion: "1.0.0",
  thresholdRegistryVersion: MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
  requestedAction: "QUARANTINE",
  reasonCode: "CONTENT_GRAPHIC_VIOLENCE",
  contentKind: "ISSUE_MEDIA",
  modality: "IMAGE",
  slice: "IMAGE_VIOLENCE",
  category: "ISSUE_MEDIA",
  source: "MODEL",
  contextState: "SUFFICIENT",
  providerStatus: "SUCCEEDED",
  providerAbstained: false,
  modelAgreement: true,
  signals: [
    {
      label: "CONTENT_GRAPHIC_VIOLENCE",
      score: 0.99,
      source: "MODEL",
      modality: "IMAGE",
      policyVersion: "1.0.0",
      sourceVersion: "omni-moderation-2024-09-26",
      evidenceCount: 2,
      evidenceValid: true,
      supported: true,
    },
  ],
  normalizedInputHash: "graphic-violence-fixture",
  previousAction: "ALLOW",
  evaluatedAt: new Date("2026-08-29T00:00:00.000Z"),
};

describe("moderation decision engine", () => {
  it("maps every product action to an existing canonical moderation state", () => {
    expect(MODERATION_DOMAIN_ACTION_MAP).toEqual({
      ALLOW: "PUBLISHED",
      NUDGE: "REVIEW",
      LIMIT: "REVIEW",
      PRIVATE_PENDING: "REVIEW",
      QUARANTINE: "QUARANTINED",
      BLOCK: "PRIVATE_REJECT",
      PROVISIONAL: "PROVISIONAL",
    });
  });

  it("fails closed for unknown, unsupported, stale, invalid, missing and provider failure inputs", () => {
    const cases: Array<{
      request: ModerationDecisionRequest;
      code: string;
    }> = [
      { request: { ...baseRequest, reasonCode: "UNKNOWN_LABEL" }, code: "UNKNOWN_REASON" },
      {
        request: { ...baseRequest, contentKind: "COMMENT" },
        code: "UNSUPPORTED_LABEL",
      },
      {
        request: { ...baseRequest, policyVersion: "0.9.0" },
        code: "STALE_POLICY_VERSION",
      },
      {
        request: {
          ...baseRequest,
          signals: [{ ...baseRequest.signals[0]!, evidenceValid: false }],
        },
        code: "INVALID_EVIDENCE",
      },
      {
        request: {
          ...baseRequest,
          signals: [{ ...baseRequest.signals[0]!, score: 1.1 }],
        },
        code: "INVALID_EVIDENCE",
      },
      { request: { ...baseRequest, signals: [] }, code: "MISSING_SIGNAL" },
      { request: { ...baseRequest, providerStatus: "FAILED" }, code: "PROVIDER_FAILURE" },
    ];

    for (const fixture of cases) {
      const result = evaluateModerationDecision({
        request: fixture.request,
        runtime: activeRuntime,
      });
      expect(result).toMatchObject({ outcome: "REVIEW", action: "PRIVATE_PENDING" });
      expect(result.rejectionCodes).toContain(fixture.code);
    }
  });

  it("uses a versioned label/action/modality/slice threshold and abstains between bands", () => {
    expect(
      findModerationDecisionThreshold({
        registryVersion: MODERATION_DECISION_THRESHOLD_REGISTRY_VERSION,
        policyVersion: "1.0.0",
        label: "CONTENT_GRAPHIC_VIOLENCE",
        action: "QUARANTINE",
        modality: "IMAGE",
        slice: "IMAGE_VIOLENCE",
      }),
    ).toMatchObject({ reviewThreshold: 0.7, actionThreshold: 0.98, minimumEvidenceCount: 2 });

    const abstained = evaluateModerationDecision({
      request: {
        ...baseRequest,
        signals: [{ ...baseRequest.signals[0]!, score: 0.9 }],
      },
      runtime: activeRuntime,
    });
    expect(abstained).toMatchObject({ outcome: "REVIEW", action: "PRIVATE_PENDING" });
    expect(abstained.rejectionCodes).toContain("ABSTAIN_THRESHOLD_BAND");
  });

  it("only permits private auto-reject for deterministic technical rule evidence", () => {
    const deterministic = evaluateModerationDecision({
      runtime: activeRuntime,
      request: {
        ...baseRequest,
        requestedAction: "BLOCK",
        reasonCode: "TECHNICAL_DECODE_FAILED",
        source: "RULE",
        contextState: "NOT_APPLICABLE",
        providerStatus: "NOT_REQUIRED",
        slice: "TECHNICAL",
        signals: [
          {
            label: "TECHNICAL_DECODE_FAILED",
            score: 1,
            source: "RULE",
            modality: "IMAGE",
            policyVersion: "1.0.0",
            sourceVersion: "which-common-rules-v1",
            evidenceCount: 1,
            evidenceValid: true,
            supported: true,
          },
        ],
      },
    });
    expect(deterministic).toMatchObject({
      outcome: "EXECUTE",
      action: "BLOCK",
      canonicalAction: "PRIVATE_REJECT",
    });

    const modelBlock = evaluateModerationDecision({
      runtime: activeRuntime,
      request: { ...baseRequest, requestedAction: "BLOCK" },
    });
    expect(modelBlock).toMatchObject({ outcome: "REVIEW", action: "PRIVATE_PENDING" });
    expect(modelBlock.rejectionCodes).toContain("THRESHOLD_NOT_REGISTERED");
    expect(modelBlock.rejectionCodes).toContain("SOURCE_NOT_AUTHORIZED");
  });

  it("executes only reversible quarantine and restores the prior state on expiry or rollback", () => {
    const decision = evaluateModerationDecision({ request: baseRequest, runtime: activeRuntime });
    expect(decision).toMatchObject({
      outcome: "EXECUTE",
      action: "QUARANTINE",
      canonicalAction: "QUARANTINED",
      reversible: true,
      expiresAt: "2026-08-30T00:00:00.000Z",
      automaticExpiryAction: "ALLOW",
      rollbackAction: "ALLOW",
    });
    expect(rollbackModerationDecision(decision)).toBe("ALLOW");
  });

  it("keeps provisional publication disabled until every release gate passes", () => {
    const request: ModerationDecisionRequest = {
      ...baseRequest,
      requestedAction: "PROVISIONAL",
      reasonCode: "NO_POLICY_VIOLATION",
      slice: "LOW_RISK_ISSUE_MEDIA",
      cohort: "trusted-beta",
      assetType: "OPTION_IMAGE",
      signals: [
        {
          ...baseRequest.signals[0]!,
          label: "NO_POLICY_VIOLATION",
          score: 0.999,
        },
      ],
    };
    const notApproved = evaluateModerationDecision({ request, runtime: activeRuntime });
    expect(notApproved.rejectionCodes).toContain("PROVISIONAL_RELEASE_NOT_APPROVED");

    const approved = evaluateModerationDecision({
      request,
      runtime: {
        ...activeRuntime,
        provisionalReleaseApproved: true,
        provisionalCohorts: ["trusted-beta"],
        provisionalAssetTypes: ["OPTION_IMAGE"],
      },
    });
    expect(approved).toMatchObject({
      outcome: "EXECUTE",
      action: "PROVISIONAL",
      automaticExpiryAction: "PRIVATE_PENDING",
      expiresAt: "2026-08-29T06:00:00.000Z",
    });
  });

  it("honors category flags, canary, budgets, human-only boundaries and the kill switch", () => {
    const fixtures: Array<[Partial<ModerationDecisionRuntime>, string]> = [
      [{ killSwitch: true }, "GLOBAL_KILL_SWITCH_ENABLED"],
      [{ categoryFlags: {} }, "CATEGORY_DISABLED"],
      [{ canaryPercent: 0 }, "OUTSIDE_CANARY"],
      [{ operationalBudgetHealthy: false }, "OPERATIONAL_BUDGET_UNHEALTHY"],
    ];
    for (const [runtime, code] of fixtures) {
      const result = evaluateModerationDecision({
        request: baseRequest,
        runtime: { ...activeRuntime, ...runtime },
      });
      expect(result.outcome).toBe("REVIEW");
      expect(result.rejectionCodes).toContain(code);
    }
    const humanOnly = evaluateModerationDecision({
      request: { ...baseRequest, humanOnlyDecision: true },
      runtime: activeRuntime,
    });
    expect(humanOnly.rejectionCodes).toContain("HUMAN_ONLY_DECISION");
  });

  it("parses a fail-closed runtime and requires explicit category allowlists", () => {
    expect(moderationDecisionRuntime({})).toMatchObject({
      mode: "OFF",
      killSwitch: true,
      canaryPercent: 0,
      categoryFlags: {},
      provisionalReleaseApproved: false,
    });
    expect(
      moderationDecisionRuntime({
        MODERATION_DECISION_MODE: "LIMITED_ACTION",
        MODERATION_DECISION_KILL_SWITCH: "false",
        MODERATION_DECISION_CANARY_PERCENT: "5",
        MODERATION_DECISION_CATEGORY_FLAGS: "ISSUE_MEDIA,COMMENT",
        MODERATION_PROVISIONAL_COHORTS: "trusted-beta",
        MODERATION_PROVISIONAL_ASSET_TYPES: "OPTION_IMAGE",
      }),
    ).toMatchObject({
      mode: "LIMITED_ACTION",
      killSwitch: false,
      canaryPercent: 5,
      categoryFlags: { ISSUE_MEDIA: true, COMMENT: true },
      provisionalCohorts: ["trusted-beta"],
      provisionalAssetTypes: ["OPTION_IMAGE"],
    });
  });
});
