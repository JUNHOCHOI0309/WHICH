import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpsModerationQueuePanel } from "@/features/operations/ops-moderation-queue-panel";

function queueResponse(recommendationVisible: boolean) {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-08-29T00:00:00.000Z",
      metrics: {
        queueCount: 1,
        oldestAgeSeconds: 20,
        reviewSecondsP50: null,
        reviewSecondsP95: null,
        averageSecondsPerAsset: null,
        weeklyOperatorHours: 0,
        inflow7d: 1,
        outflow7d: 0,
      },
      counts: { HIGH: 0, NORMAL: 0, RIGHTS: 0, APPEAL: 0, RANDOM_AUDIT: 1 },
      operational: {
        provider: {
          mode: "OFF",
          provider: "NONE",
          killSwitch: true,
          canaryPercent: 0,
          dailyCallCap: 0,
          dailyCostMicrosCap: 0,
          circuitWindowMinutes: 5,
          circuitMinimumCalls: 5,
          circuitFailurePercent: 50,
          modelSnapshot: "test",
          apiKeyConfigured: false,
          privacyGateAllowed: false,
          privacyGateReason: "PROVIDER_MODE_OFF",
          missingEvidence: [],
          callsToday: 0,
          calls7d: 0,
          succeeded7d: 0,
          failed7d: 0,
          skipped7d: 0,
          costMicrosToday: 0,
          costMicros7d: 0,
          latencyP95Ms: null,
          errorRate7d: 0,
          cacheHitRate7d: 0,
          automationCoverage7d: 0,
          circuitState: "CLOSED",
        },
        worker: {
          pending: 0,
          running: 0,
          failed: 0,
          deadLettered: 0,
          oldestPendingAgeSeconds: null,
        },
        reconciliation: { mismatches: 0, failed: 0, repaired7d: 0 },
        directUploadAllowed: true,
        alerts: [],
      },
      items: [
        {
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedRevision: 1,
          lane: "RANDOM_AUDIT",
          priority: "P3",
          status: "OPEN",
          targetType: "ISSUE_MEDIA_ASSET",
          targetId: "22222222-2222-4222-8222-222222222222",
          openedAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          risky: false,
          summary: "Blind audit image",
          cluster: null,
          reviewerAssist: {
            reviewId: null,
            requiresProvisionalLabel: true,
            provisionalLabel: recommendationVisible ? "ALLOW" : null,
            provisionalRationale: recommendationVisible ? "human first" : null,
            recommendationVisible,
            recommendation: recommendationVisible ? null : null,
            startedAt: null,
            aiRevealedAt: recommendationVisible ? "2026-08-29T00:00:01.000Z" : null,
          },
          context: {
            kind: "IMAGE",
            assetId: "22222222-2222-4222-8222-222222222222",
            question: null,
            choices: [],
            rightsAttestation: "rights asserted",
            rightsState: "ASSERTED",
            uploadedBy: "operator",
            input: { width: 100, height: 100, byteSize: 100 },
            output: { width: 100, height: 100, byteSize: 80 },
            findings: [],
            evidenceGroups: {
              RULE: [],
              REPORT: [],
              RIGHTS: [],
              OCR_QR_PII: [],
              SAFETY_MODEL: [],
              SIMILAR_IMAGE: [],
            },
            relevance: { supported: false, findings: [] },
            visualAsymmetry: { supported: false, findings: [] },
            similarDecisions: [],
            priorDecisions: [],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Ops moderation Reviewer Assist", () => {
  it("shows an uncapped daily budget explicitly", async () => {
    const payload = await queueResponse(false).json();
    payload.operational.provider.dailyLimitsEnabled = false;
    payload.operational.provider.callsToday = 12;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    render(<OpsModerationQueuePanel />);
    expect(await screen.findByText("12 / 제한 없음")).toBeInTheDocument();
  });
  it("keeps Random Audit AI assist hidden behind a human provisional label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => queueResponse(false)),
    );
    render(<OpsModerationQueuePanel />);

    expect(await screen.findByText("AI 추천을 보기 전에 선판정을 기록하세요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "ALLOW" })).toBeVisible();
    expect(screen.queryByText("AI REVIEWER ASSIST")).not.toBeInTheDocument();
  });

  it("falls back to an explicit manual mode when no AI recommendation exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => queueResponse(true)),
    );
    render(<OpsModerationQueuePanel />);

    expect(await screen.findByText("AI 근거가 없어 수동 검수 모드로 진행합니다.")).toBeVisible();
    expect(screen.queryByText("AI 추천을 보기 전에 선판정을 기록하세요.")).not.toBeInTheDocument();
  });
});
