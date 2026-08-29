import {
  CANONICAL_MODERATION_ACTIONS,
  MODERATION_REASON_CODES,
  type CanonicalModerationAction,
  type ModerationReasonCode,
} from "../moderation/policy-registry.js";
import {
  REQUIRED_MODERATION_EVALUATION_SLICES,
  moderationEvaluationRunSchema,
  moderationGoldenDatasetSchema,
  type ModerationEvaluationRun,
  type ModerationGoldenCase,
  type ModerationGoldenDataset,
  type ModerationGoldenVerdict,
} from "./contracts.js";

type ResolvedCase = {
  goldenCase: ModerationGoldenCase;
  verdict: ModerationGoldenVerdict | null;
  humanOnly: boolean;
  adjudicated: boolean;
};

export type BinaryMetric = {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  precision95: { low: number; high: number } | null;
  recall95: { low: number; high: number } | null;
  criticalFalseNegatives: number;
};

function binaryMetric(input: {
  results: ModerationCaseResult[];
  expected: (result: ModerationCaseResult) => boolean;
  predicted: (result: ModerationCaseResult) => boolean;
}): BinaryMetric {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let criticalFalseNegatives = 0;
  for (const result of input.results) {
    const expected = input.expected(result);
    const predicted = !result.abstained && input.predicted(result);
    if (expected && predicted) truePositive += 1;
    if (!expected && predicted) falsePositive += 1;
    if (expected && !predicted) {
      falseNegative += 1;
      if (result.critical) criticalFalseNegatives += 1;
    }
  }
  const predictedPositive = truePositive + falsePositive;
  const actualPositive = truePositive + falseNegative;
  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision: predictedPositive === 0 ? null : truePositive / predictedPositive,
    recall: actualPositive === 0 ? null : truePositive / actualPositive,
    precision95: wilsonInterval(truePositive, predictedPositive),
    recall95: wilsonInterval(truePositive, actualPositive),
    criticalFalseNegatives,
  };
}

function stableVerdict(value: unknown) {
  return JSON.stringify(value);
}

function reviewResolutionKey(review: ModerationGoldenCase["reviews"][number]) {
  return stableVerdict({
    verdict: review.verdict
      ? { ...review.verdict, reasonCodes: [...review.verdict.reasonCodes].sort() }
      : null,
    humanWorkflow: review.humanWorkflow,
  });
}

function resolveCase(goldenCase: ModerationGoldenCase): ResolvedCase {
  const [first, second] = goldenCase.reviews;
  if (!first || !second) throw new Error(`Case ${goldenCase.caseId} needs two reviews.`);
  const agreed = reviewResolutionKey(first) === reviewResolutionKey(second);
  const resolved = agreed ? first : goldenCase.adjudication;
  if (!resolved) {
    throw new Error(`Case ${goldenCase.caseId} has reviewer disagreement without adjudication.`);
  }
  return {
    goldenCase,
    verdict: resolved.verdict,
    humanOnly: resolved.humanWorkflow !== null,
    adjudicated: !agreed,
  };
}

export function wilsonInterval(successes: number, total: number, z = 1.959963984540054) {
  if (total === 0) return null;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function toBinaryMetric(input: {
  action: CanonicalModerationAction;
  results: ModerationCaseResult[];
}): BinaryMetric {
  return binaryMetric({
    results: input.results,
    expected: (result) => result.expectedAction === input.action,
    predicted: (result) => result.predictedAction === input.action,
  });
}

function toReasonMetric(reasonCode: ModerationReasonCode, results: ModerationCaseResult[]) {
  return binaryMetric({
    results,
    expected: (result) => result.expectedReasonCodes.includes(reasonCode),
    predicted: (result) => result.predictedReasonCodes.includes(reasonCode),
  });
}

export function validateGoldenDataset(input: unknown) {
  const dataset = moderationGoldenDatasetSchema.parse(input);
  const resolvedCases = dataset.cases.map(resolveCase);
  const presentSlices = new Set(dataset.cases.flatMap((goldenCase) => goldenCase.slices));
  const missingSlices = Object.values(REQUIRED_MODERATION_EVALUATION_SLICES)
    .flat()
    .filter((slice) => !presentSlices.has(slice));
  const modalityCounts = Object.fromEntries(
    ["TEXT", "IMAGE", "MULTIMODAL"].map((modality) => [
      modality,
      dataset.cases.filter((goldenCase) => goldenCase.modality === modality).length,
    ]),
  );
  return {
    dataset,
    summary: {
      caseCount: dataset.cases.length,
      evaluableCount: resolvedCases.filter((item) => !item.humanOnly).length,
      humanWorkflowCount: resolvedCases.filter((item) => item.humanOnly).length,
      adjudicatedCount: resolvedCases.filter((item) => item.adjudicated).length,
      modalityCounts,
      missingSlices,
      coverageReady: missingSlices.length === 0,
    },
  };
}

export type ModerationCaseResult = {
  caseId: string;
  cohort: ModerationGoldenCase["cohort"];
  slices: string[];
  expectedAction: CanonicalModerationAction;
  expectedReasonCodes: ModerationReasonCode[];
  predictedAction: CanonicalModerationAction | null;
  predictedReasonCodes: ModerationReasonCode[];
  abstained: boolean;
  confidence: number;
  correct: boolean;
  critical: boolean;
  reviewerOverride: boolean | null;
};

function cohortGate(
  results: ModerationCaseResult[],
  cohort: ModerationGoldenCase["cohort"],
  target: number,
) {
  const cohortResults = results.filter((result) => result.cohort === cohort).slice(0, target);
  const criticalFalseNegatives = cohortResults.filter(
    (result) => result.critical && !result.correct,
  ).length;
  return {
    target,
    evaluated: cohortResults.length,
    complete: cohortResults.length >= target,
    criticalFalseNegatives,
    zeroCriticalMiss: cohortResults.length >= target && criticalFalseNegatives === 0,
  };
}

export function evaluateModerationRun(datasetInput: unknown, runInput: unknown) {
  const { dataset, summary: datasetSummary } = validateGoldenDataset(datasetInput);
  const run = moderationEvaluationRunSchema.parse(runInput);
  if (run.datasetVersion !== dataset.datasetVersion) {
    throw new Error(
      `Dataset version mismatch: ${run.datasetVersion} != ${dataset.datasetVersion}.`,
    );
  }
  if (run.policyVersion !== dataset.policyVersion) {
    throw new Error(`Policy version mismatch: ${run.policyVersion} != ${dataset.policyVersion}.`);
  }
  const resolvedCases = dataset.cases.map(resolveCase);
  const evaluable = resolvedCases.filter(
    (resolved): resolved is ResolvedCase & { verdict: ModerationGoldenVerdict } =>
      !resolved.humanOnly && resolved.verdict !== null,
  );
  const knownCaseIds = new Set(dataset.cases.map((goldenCase) => goldenCase.caseId));
  const unknownPredictions = run.predictions
    .filter((prediction) => !knownCaseIds.has(prediction.caseId))
    .map((prediction) => prediction.caseId);
  if (unknownPredictions.length > 0) {
    throw new Error(`Unknown prediction Case IDs: ${unknownPredictions.join(", ")}`);
  }
  const predictionByCase = new Map(
    run.predictions.map((prediction) => [prediction.caseId, prediction] as const),
  );
  const missingPredictionIds: string[] = [];
  const results: ModerationCaseResult[] = evaluable.map(({ goldenCase, verdict }) => {
    const prediction = predictionByCase.get(goldenCase.caseId);
    if (!prediction) missingPredictionIds.push(goldenCase.caseId);
    const predictedAction = prediction?.predictedAction ?? null;
    const abstained = prediction?.abstained ?? true;
    return {
      caseId: goldenCase.caseId,
      cohort: goldenCase.cohort,
      slices: goldenCase.slices,
      expectedAction: verdict.action,
      expectedReasonCodes: [...verdict.reasonCodes],
      predictedAction,
      predictedReasonCodes: prediction?.reasonCodes ?? [],
      abstained,
      confidence: prediction?.confidence ?? 0,
      correct: !abstained && predictedAction === verdict.action,
      critical: verdict.critical,
      reviewerOverride:
        prediction?.reviewerAction === undefined
          ? null
          : prediction.reviewerAction !== predictedAction,
    };
  });

  const actionMetrics = Object.fromEntries(
    CANONICAL_MODERATION_ACTIONS.map((action) => [action, toBinaryMetric({ action, results })]),
  ) as Record<CanonicalModerationAction, BinaryMetric>;
  const reasonMetrics = Object.fromEntries(
    MODERATION_REASON_CODES.map((reasonCode) => [reasonCode, toReasonMetric(reasonCode, results)]),
  ) as Record<ModerationReasonCode, BinaryMetric>;
  const sliceNames = [...new Set(results.flatMap((result) => result.slices))].sort();
  const sliceMetrics = Object.fromEntries(
    sliceNames.map((slice) => {
      const sliceResults = results.filter((result) => result.slices.includes(slice));
      const correct = sliceResults.filter((result) => result.correct).length;
      return [
        slice,
        {
          evaluated: sliceResults.length,
          accuracy: sliceResults.length === 0 ? null : correct / sliceResults.length,
          abstained: sliceResults.filter((result) => result.abstained).length,
          criticalFalseNegatives: sliceResults.filter(
            (result) => result.critical && !result.correct,
          ).length,
          actions: Object.fromEntries(
            CANONICAL_MODERATION_ACTIONS.map((action) => [
              action,
              toBinaryMetric({ action, results: sliceResults }),
            ]),
          ),
        },
      ];
    }),
  );
  const reviewed = results.filter((result) => result.reviewerOverride !== null);
  const overrides = reviewed.filter((result) => result.reviewerOverride).length;
  const totalCostMicros = run.predictions.reduce(
    (total, prediction) => total + prediction.costMicros,
    0,
  );
  const totalLatencyMs = run.predictions.reduce(
    (total, prediction) => total + prediction.latencyMs,
    0,
  );
  const worstSlice = Object.entries(sliceMetrics)
    .filter(([, metric]) => metric.accuracy !== null)
    .sort((left, right) => (left[1].accuracy ?? 1) - (right[1].accuracy ?? 1))[0];
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run: {
      runId: run.runId,
      datasetVersion: run.datasetVersion,
      policyVersion: run.policyVersion,
      modelProvider: run.modelProvider,
      modelName: run.modelName,
      modelVersion: run.modelVersion,
      promptVersion: run.promptVersion,
    },
    dataset: datasetSummary,
    coverage: {
      expected: evaluable.length,
      evaluated: results.length - missingPredictionIds.length,
      missingPredictionIds,
      complete: missingPredictionIds.length === 0,
    },
    overall: {
      correct: results.filter((result) => result.correct).length,
      accuracy:
        results.length === 0
          ? null
          : results.filter((result) => result.correct).length / results.length,
      abstained: results.filter((result) => result.abstained).length,
      abstainRate:
        results.length === 0
          ? null
          : results.filter((result) => result.abstained).length / results.length,
      criticalFalseNegatives: results.filter((result) => result.critical && !result.correct).length,
      reviewerOverrides: overrides,
      reviewerOverrideRate: reviewed.length === 0 ? null : overrides / reviewed.length,
      totalLatencyMs,
      totalCostMicros,
    },
    actionMetrics,
    reasonMetrics,
    sliceMetrics,
    worstSlice: worstSlice ? { slice: worstSlice[0], ...worstSlice[1] } : null,
    releaseGates: {
      zeroCriticalReference: cohortGate(results, "ZERO_CRITICAL_REFERENCE", 300),
      provisionalAudit: cohortGate(results, "PROVISIONAL_AUDIT", 500),
    },
    humanWorkflowCases: resolvedCases
      .filter((item) => item.humanOnly)
      .map((item) => item.goldenCase.caseId),
    results,
  };
  return report;
}

export type ModerationEvaluationReport = ReturnType<typeof evaluateModerationRun>;

function actionDistribution(report: ModerationEvaluationReport) {
  const total = report.results.length || 1;
  return Object.fromEntries(
    CANONICAL_MODERATION_ACTIONS.map((action) => [
      action,
      report.results.filter((result) => result.predictedAction === action).length / total,
    ]),
  ) as Record<CanonicalModerationAction, number>;
}

export function compareModerationReports(
  candidate: ModerationEvaluationReport,
  baseline: ModerationEvaluationReport,
) {
  const baselineByCase = new Map(
    baseline.results.map((result) => [result.caseId, result] as const),
  );
  const sharedResults = candidate.results.filter((result) => baselineByCase.has(result.caseId));
  const changedPredictions = sharedResults.filter((result) => {
    const baselineResult = baselineByCase.get(result.caseId);
    return (
      baselineResult?.predictedAction !== result.predictedAction ||
      stableVerdict([...(baselineResult?.predictedReasonCodes ?? [])].sort()) !==
        stableVerdict([...result.predictedReasonCodes].sort())
    );
  }).length;
  const candidateDistribution = actionDistribution(candidate);
  const baselineDistribution = actionDistribution(baseline);
  const distributionDrift =
    CANONICAL_MODERATION_ACTIONS.reduce(
      (total, action) =>
        total + Math.abs(candidateDistribution[action] - baselineDistribution[action]),
      0,
    ) / 2;
  return {
    candidateVersions: candidate.run,
    baselineVersions: baseline.run,
    datasetChanged: candidate.run.datasetVersion !== baseline.run.datasetVersion,
    policyChanged: candidate.run.policyVersion !== baseline.run.policyVersion,
    modelChanged:
      candidate.run.modelProvider !== baseline.run.modelProvider ||
      candidate.run.modelName !== baseline.run.modelName ||
      candidate.run.modelVersion !== baseline.run.modelVersion,
    promptChanged: candidate.run.promptVersion !== baseline.run.promptVersion,
    sharedCaseCount: sharedResults.length,
    predictionChangedRate:
      sharedResults.length === 0 ? null : changedPredictions / sharedResults.length,
    actionDistributionTotalVariation: distributionDrift,
    accuracyDelta:
      candidate.overall.accuracy === null || baseline.overall.accuracy === null
        ? null
        : candidate.overall.accuracy - baseline.overall.accuracy,
    abstainRateDelta:
      candidate.overall.abstainRate === null || baseline.overall.abstainRate === null
        ? null
        : candidate.overall.abstainRate - baseline.overall.abstainRate,
    criticalFalseNegativeDelta:
      candidate.overall.criticalFalseNegatives - baseline.overall.criticalFalseNegatives,
    reviewerOverrideRateDelta:
      candidate.overall.reviewerOverrideRate === null ||
      baseline.overall.reviewerOverrideRate === null
        ? null
        : candidate.overall.reviewerOverrideRate - baseline.overall.reviewerOverrideRate,
    actionDeltas: Object.fromEntries(
      CANONICAL_MODERATION_ACTIONS.map((action) => [
        action,
        {
          precision:
            candidate.actionMetrics[action].precision === null ||
            baseline.actionMetrics[action].precision === null
              ? null
              : candidate.actionMetrics[action].precision -
                baseline.actionMetrics[action].precision,
          recall:
            candidate.actionMetrics[action].recall === null ||
            baseline.actionMetrics[action].recall === null
              ? null
              : candidate.actionMetrics[action].recall - baseline.actionMetrics[action].recall,
          criticalFalseNegatives:
            candidate.actionMetrics[action].criticalFalseNegatives -
            baseline.actionMetrics[action].criticalFalseNegatives,
        },
      ]),
    ),
    reasonDeltas: Object.fromEntries(
      MODERATION_REASON_CODES.map((reasonCode) => [
        reasonCode,
        {
          precision:
            candidate.reasonMetrics[reasonCode].precision === null ||
            baseline.reasonMetrics[reasonCode].precision === null
              ? null
              : candidate.reasonMetrics[reasonCode].precision -
                baseline.reasonMetrics[reasonCode].precision,
          recall:
            candidate.reasonMetrics[reasonCode].recall === null ||
            baseline.reasonMetrics[reasonCode].recall === null
              ? null
              : candidate.reasonMetrics[reasonCode].recall -
                baseline.reasonMetrics[reasonCode].recall,
          criticalFalseNegatives:
            candidate.reasonMetrics[reasonCode].criticalFalseNegatives -
            baseline.reasonMetrics[reasonCode].criticalFalseNegatives,
        },
      ]),
    ),
  };
}

export function createPerfectSmokeRun(dataset: ModerationGoldenDataset): ModerationEvaluationRun {
  const predictions = dataset.cases.flatMap((goldenCase) => {
    const resolved = resolveCase(goldenCase);
    if (!resolved.verdict) return [];
    return [
      {
        caseId: goldenCase.caseId,
        predictedAction: resolved.verdict.action,
        reasonCodes: [...resolved.verdict.reasonCodes],
        abstained: false,
        confidence: 1,
        reviewerAction: resolved.verdict.action,
        latencyMs: 0,
        costMicros: 0,
      },
    ];
  });
  return {
    schemaVersion: 1,
    runId: "which-100-perfect-smoke",
    datasetVersion: dataset.datasetVersion,
    policyVersion: dataset.policyVersion,
    modelProvider: "FIXTURE",
    modelName: "perfect-smoke",
    modelVersion: "v1",
    promptVersion: "none",
    createdAt: new Date().toISOString(),
    predictions,
  };
}
