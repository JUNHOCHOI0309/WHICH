import { describe, expect, it } from "vitest";

import { moderationGoldenDatasetSchema } from "../src/modules/moderation-evaluation/contracts.js";
import {
  compareModerationReports,
  createPerfectSmokeRun,
  evaluateModerationRun,
  validateGoldenDataset,
  wilsonInterval,
} from "../src/modules/moderation-evaluation/evaluator.js";
import { WHICH_100_SMOKE_GOLDEN_SET } from "../src/modules/moderation-evaluation/golden-set.js";

describe("Moderation Golden Set evaluation", () => {
  it("covers every required Korean Text, Image, and Multimodal slice", () => {
    const validated = validateGoldenDataset(WHICH_100_SMOKE_GOLDEN_SET);
    expect(validated.summary).toMatchObject({
      caseCount: 30,
      evaluableCount: 28,
      humanWorkflowCount: 2,
      missingSlices: [],
      coverageReady: true,
    });
  });

  it("keeps binary/public references and rights truth outside the model label", () => {
    const serialized = JSON.stringify(WHICH_100_SMOKE_GOLDEN_SET);
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("data:image");
    const rightsCase = WHICH_100_SMOKE_GOLDEN_SET.cases.find(
      (goldenCase) => goldenCase.caseId === "human-rights-ownership",
    );
    expect(rightsCase?.reviews.every((review) => review.verdict === null)).toBe(true);
    expect(rightsCase?.reviews.every((review) => review.humanWorkflow?.outcome === "PENDING")).toBe(
      true,
    );

    const invalid = structuredClone(WHICH_100_SMOKE_GOLDEN_SET);
    invalid.cases[0]!.privateReference = "https://public.example/case";
    expect(() => moderationGoldenDatasetSchema.parse(invalid)).toThrow(/private references/iu);
  });

  it("requires independent review disagreement to be adjudicated", () => {
    const invalid = structuredClone(WHICH_100_SMOKE_GOLDEN_SET);
    invalid.cases[0]!.reviews[1]!.verdict = {
      action: "REVIEW",
      reasonCodes: ["OTHER"],
      critical: false,
    };
    expect(() => validateGoldenDataset(invalid)).toThrow(/without adjudication/iu);

    invalid.cases[0]!.adjudication = {
      reviewerId: "golden-adjudicator",
      reviewedAt: "2026-08-29T00:00:00.000Z",
      verdict: invalid.cases[0]!.reviews[0]!.verdict,
      humanWorkflow: null,
    };
    expect(validateGoldenDataset(invalid).summary.adjudicatedCount).toBe(1);
  });

  it("reports Action metrics, confidence intervals, abstention, worst slice, and overrides", () => {
    const run = createPerfectSmokeRun(WHICH_100_SMOKE_GOLDEN_SET);
    const threat = run.predictions.find(
      (prediction) => prediction.caseId === "text-threat-redacted",
    );
    if (!threat) throw new Error("Threat fixture is missing.");
    threat.predictedAction = null;
    threat.abstained = true;
    threat.confidence = 0.25;
    threat.reviewerAction = "QUARANTINED";
    const report = evaluateModerationRun(WHICH_100_SMOKE_GOLDEN_SET, run);
    expect(report.coverage).toMatchObject({ expected: 28, evaluated: 28, complete: true });
    expect(report.overall).toMatchObject({
      correct: 27,
      abstained: 1,
      criticalFalseNegatives: 1,
      reviewerOverrides: 1,
    });
    expect(report.actionMetrics.QUARANTINED.falseNegative).toBe(1);
    expect(report.reasonMetrics.THREAT.falseNegative).toBe(1);
    expect(report.actionMetrics.QUARANTINED.recall95).not.toBeNull();
    expect(report.worstSlice?.slice).toBe("TEXT_THREAT");
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it("reports the 300 zero-critical-miss reference and first 500 provisional audit separately", () => {
    const base = WHICH_100_SMOKE_GOLDEN_SET.cases.find(
      (goldenCase) => goldenCase.caseId === "text-threat-redacted",
    );
    if (!base) throw new Error("Critical base fixture is missing.");
    const cases = Array.from({ length: 800 }, (_, index) => ({
      ...structuredClone(base),
      caseId: `gate-case-${index.toString().padStart(3, "0")}`,
      privateReference: `golden://gate-case-${index.toString().padStart(3, "0")}`,
      cohort: index < 300 ? ("ZERO_CRITICAL_REFERENCE" as const) : ("PROVISIONAL_AUDIT" as const),
    }));
    const dataset = {
      ...WHICH_100_SMOKE_GOLDEN_SET,
      datasetVersion: "gate-test-v1",
      cases,
    };
    const run = createPerfectSmokeRun(dataset);
    run.datasetVersion = dataset.datasetVersion;
    run.predictions[0]!.predictedAction = "REVIEW";
    const report = evaluateModerationRun(dataset, run);
    expect(report.releaseGates.zeroCriticalReference).toMatchObject({
      evaluated: 300,
      complete: true,
      criticalFalseNegatives: 1,
      zeroCriticalMiss: false,
    });
    expect(report.releaseGates.provisionalAudit).toMatchObject({
      evaluated: 500,
      complete: true,
      criticalFalseNegatives: 0,
      zeroCriticalMiss: true,
    });
  });

  it("compares Model, Prompt, Policy, and Dataset regression dimensions", () => {
    const baselineRun = createPerfectSmokeRun(WHICH_100_SMOKE_GOLDEN_SET);
    const candidateRun = structuredClone(baselineRun);
    candidateRun.runId = "candidate-run";
    candidateRun.modelVersion = "v2";
    candidateRun.promptVersion = "prompt-v2";
    candidateRun.predictions[0]!.predictedAction = "REVIEW";
    const baseline = evaluateModerationRun(WHICH_100_SMOKE_GOLDEN_SET, baselineRun);
    const candidate = evaluateModerationRun(WHICH_100_SMOKE_GOLDEN_SET, candidateRun);
    const comparison = compareModerationReports(candidate, baseline);
    expect(comparison).toMatchObject({
      modelChanged: true,
      promptChanged: true,
      policyChanged: false,
      datasetChanged: false,
      sharedCaseCount: 28,
    });
    expect(comparison.predictionChangedRate).toBeGreaterThan(0);
    expect(comparison.accuracyDelta).toBeLessThan(0);
  });
});
