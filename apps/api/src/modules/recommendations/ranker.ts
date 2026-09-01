import { createHash } from "node:crypto";

import type { InterestCardCode } from "../interests/contracts.js";
import type {
  CandidateSource,
  QualityScoreComponents,
  RankableIssue,
  RankedIssue,
} from "./contracts.js";

const emptyComponents = (): QualityScoreComponents => ({
  interest: 0,
  freshness: 0,
  editorial: 0,
  behavior: 0,
  exploration: 0,
  safetyPenalty: 0,
});

function legacyResult(
  issue: RankableIssue,
  score: number,
  explorationScore: number,
  reasonCodes: RankedIssue["reasonCodes"],
  matchedCardCodes: RankedIssue["matchedCardCodes"],
): RankedIssue {
  return {
    ...issue,
    score,
    explorationScore,
    reasonCodes,
    matchedCardCodes,
    candidateSources: reasonCodes.includes("RECENT_FALLBACK")
      ? ["DEFAULT_FALLBACK"]
      : matchedCardCodes.length > 0
        ? ["INTEREST", "EXPLORATION"]
        : ["EXPLORATION"],
    scoreComponents: emptyComponents(),
    controversyEligible: false,
    qualityScore: score,
    shadowPosition: null,
    qualityEligible: true,
    eligibilityReasons: [],
  };
}

function stableScore(seed: string, issueId: string, range: number, prefix: string) {
  const digest = createHash("sha256").update(`${prefix}:${seed}:${issueId}`).digest();
  return digest.readUInt32BE(0) % range;
}

function personalizedExplorationScore(
  subjectId: string | null,
  profileVersion: number | null,
  rankingSeed: string,
  issueId: string,
) {
  if (!subjectId || !profileVersion) return 0;
  return stableScore(`${subjectId}:${profileVersion}:${rankingSeed}`, issueId, 10, "personalized");
}

export function rankIssues(
  issues: RankableIssue[],
  selectedCardCodes: InterestCardCode[],
  subjectId: string | null,
  profileVersion: number | null,
  rankingSeed: string,
) {
  const selected = new Set(selectedCardCodes);
  return issues
    .map<RankedIssue>((issue) => {
      const matchedCardCodes = [...issue.cardWeights.keys()]
        .filter((code) => selected.has(code))
        .sort();
      const matchScore = matchedCardCodes.reduce(
        (total, code) => total + (issue.cardWeights.get(code) ?? 0),
        0,
      );
      const explorationScore = personalizedExplorationScore(
        subjectId,
        profileVersion,
        rankingSeed,
        issue.id,
      );
      const reasonCodes: RankedIssue["reasonCodes"] = [];
      if (matchScore > 0) reasonCodes.push("INTEREST_MATCH");
      if (explorationScore > 0) reasonCodes.push("EXPLORATION");
      if (reasonCodes.length === 0) reasonCodes.push("RECENT_FALLBACK");
      return legacyResult(
        issue,
        matchScore * 10 + explorationScore,
        explorationScore,
        reasonCodes,
        matchedCardCodes,
      );
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt.valueOf() - left.publishedAt.valueOf() ||
        right.id.localeCompare(left.id),
    );
}

export function rankDiscoveryIssues(issues: RankableIssue[], rankingSeed: string) {
  return issues
    .map<RankedIssue>((issue) => {
      const societyWeight = issue.cardWeights.get("SOCIETY") ?? 0;
      const dailyLifeWeight = issue.cardWeights.get("DAILY_LIFE") ?? 0;
      const defaultTopicBoost = Math.max(societyWeight > 0 ? 35 : 0, dailyLifeWeight > 0 ? 30 : 0);
      const explorationScore = stableScore(rankingSeed, issue.id, 100, "discovery");
      const reasonCodes: RankedIssue["reasonCodes"] = [];
      if (defaultTopicBoost > 0) reasonCodes.push("DEFAULT_TOPIC_BOOST");
      if (explorationScore > 0) reasonCodes.push("EXPLORATION");
      if (reasonCodes.length === 0) reasonCodes.push("RECENT_FALLBACK");

      return legacyResult(
        issue,
        defaultTopicBoost + explorationScore,
        explorationScore,
        reasonCodes,
        [],
      );
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt.valueOf() - left.publishedAt.valueOf() ||
        right.id.localeCompare(left.id),
    );
}

export function rankRecencyIssues(issues: RankableIssue[]) {
  return issues
    .map((issue) => legacyResult(issue, 0, 0, ["RECENT_FALLBACK"], []))
    .sort(
      (left, right) =>
        right.publishedAt.valueOf() - left.publishedAt.valueOf() || right.id.localeCompare(left.id),
    );
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function rate(numerator: number, denominator: number) {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function normalizedQuestion(value: string | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function similarQuestion(left: string | undefined, right: string | undefined) {
  const leftTokens = new Set(normalizedQuestion(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedQuestion(right).split(" ").filter(Boolean));
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.75;
}

function qualityScore(
  issue: RankableIssue,
  selectedCardCodes: InterestCardCode[],
  rankingSeed: string,
  now: Date,
) {
  const selected = new Set(selectedCardCodes);
  const matchedCardCodes = [...issue.cardWeights.keys()]
    .filter((code) => selected.has(code))
    .sort();
  const rawInterest = matchedCardCodes.reduce(
    (total, code) => total + (issue.cardWeights.get(code) ?? 0),
    0,
  );
  const ageHours = Math.max(0, now.valueOf() - issue.publishedAt.valueOf()) / 3_600_000;
  const signals = issue.qualitySignals ?? {
    viewableImpressions: 0,
    acceptedA: 0,
    acceptedB: 0,
    acceptedC: 0,
    acceptedD: 0,
    averageDecisionMs: null,
    nextIssueOpens: 0,
    commentCompletions: 0,
    shareCompletions: 0,
    skips: 0,
    reports: 0,
  };
  const choiceLabels = issue.choiceLabels ?? [];
  const activeChoiceCount = Math.max(2, Math.min(4, choiceLabels.length || 2));
  const choiceCounts = [
    signals.acceptedA,
    signals.acceptedB,
    signals.acceptedC,
    signals.acceptedD,
  ].slice(0, activeChoiceCount);
  const acceptedVotes = choiceCounts.reduce((total, count) => total + count, 0);
  const confidence = signals.viewableImpressions / (signals.viewableImpressions + 30);
  const voteRate = rate(acceptedVotes, signals.viewableImpressions);
  const nextRate = rate(signals.nextIssueOpens, acceptedVotes);
  const conversationRate = rate(
    signals.commentCompletions + signals.shareCompletions,
    acceptedVotes,
  );
  const skipRate = rate(signals.skips, signals.viewableImpressions);
  const reportRate = rate(signals.reports, Math.max(acceptedVotes, 1));
  const decisionQuality =
    signals.averageDecisionMs === null
      ? 0.5
      : signals.averageDecisionMs >= 900 && signals.averageDecisionMs <= 45_000
        ? 1
        : 0.25;
  const choiceLengths = choiceLabels.map((label) => label.length);
  const choiceParity =
    choiceLengths.length === 0 || Math.max(...choiceLengths) === 0
      ? 0
      : 1 - Math.min(1, (Math.max(...choiceLengths) - Math.min(...choiceLengths)) / 24);
  const components: QualityScoreComponents = {
    interest: clamp(rawInterest / 10, 0, 100),
    freshness: clamp(100 - ageHours / 3, 0, 100),
    editorial: clamp(
      35 +
        (issue.context?.trim() ? 25 : 0) +
        choiceParity * 25 +
        ((issue.question?.length ?? 0) >= 12 ? 15 : 0),
    ),
    behavior: clamp(
      confidence *
        (Math.min(voteRate, 1) * 45 +
          Math.min(nextRate, 1) * 20 +
          Math.min(conversationRate, 1) * 15 +
          decisionQuality * 20),
    ),
    exploration: stableScore(rankingSeed, issue.id, 100, "quality-exploration"),
    safetyPenalty: clamp(skipRate * 55 + reportRate * 300, 0, 100),
  };
  const eligibilityReasons: string[] = [];
  if (signals.viewableImpressions >= 20 && skipRate >= 0.75)
    eligibilityReasons.push("EXCESSIVE_SKIP");
  if (signals.reports >= 3 && reportRate >= 0.08) eligibilityReasons.push("REPORT_RISK");
  const qualityEligible = eligibilityReasons.length === 0;
  const balance =
    acceptedVotes === 0
      ? 0
      : 1 - (Math.max(...choiceCounts) - Math.min(...choiceCounts)) / acceptedVotes;
  const controversyEligible =
    qualityEligible &&
    signals.viewableImpressions >= 20 &&
    acceptedVotes >= 8 &&
    voteRate >= 0.12 &&
    balance >= 0.65 &&
    skipRate < 0.6 &&
    reportRate < 0.05;
  const candidateSources: CandidateSource[] = [];
  if (components.interest > 0) candidateSources.push("INTEREST");
  if (components.freshness >= 60) candidateSources.push("FRESH");
  if (components.editorial >= 70) candidateSources.push("EDITORIAL_QUALITY");
  if (components.behavior >= 45) candidateSources.push("BEHAVIOR_QUALITY");
  candidateSources.push("EXPLORATION");
  if (candidateSources.length === 1) candidateSources.push("DEFAULT_FALLBACK");
  const score = clamp(
    components.interest * 0.34 +
      components.freshness * 0.18 +
      components.editorial * 0.18 +
      components.behavior * 0.24 +
      components.exploration * 0.06 -
      components.safetyPenalty * 0.35,
    0,
    100,
  );
  return {
    issue,
    score,
    components,
    matchedCardCodes,
    candidateSources,
    controversyEligible,
    qualityEligible,
    eligibilityReasons,
  };
}

export function rankQualityIssues(
  issues: RankableIssue[],
  selectedCardCodes: InterestCardCode[],
  rankingSeed: string,
  now = new Date(),
) {
  const candidates = issues
    .map((issue) => qualityScore(issue, selectedCardCodes, rankingSeed, now))
    .sort(
      (left, right) =>
        Number(right.qualityEligible) - Number(left.qualityEligible) ||
        right.score - left.score ||
        right.issue.publishedAt.valueOf() - left.issue.publishedAt.valueOf() ||
        right.issue.id.localeCompare(left.issue.id),
    );
  const result: RankedIssue[] = [];
  const deferred = [...candidates];
  const authorCounts = new Map<string, number>();
  while (deferred.length > 0) {
    const index = deferred.findIndex((candidate) => {
      if (!candidate.qualityEligible) return false;
      const recent = result.slice(-2);
      if (
        candidate.issue.categoryCode &&
        recent.length === 2 &&
        recent.every((item) => item.categoryCode === candidate.issue.categoryCode)
      )
        return false;
      if (candidate.issue.authorId && (authorCounts.get(candidate.issue.authorId) ?? 0) >= 2)
        return false;
      if (
        result.some(
          (item) =>
            (candidate.issue.contentHash && item.contentHash === candidate.issue.contentHash) ||
            similarQuestion(item.question, candidate.issue.question),
        )
      )
        return false;
      return true;
    });
    const [candidate] = deferred.splice(index >= 0 ? index : 0, 1);
    if (!candidate) break;
    if (candidate.issue.authorId) {
      authorCounts.set(
        candidate.issue.authorId,
        (authorCounts.get(candidate.issue.authorId) ?? 0) + 1,
      );
    }
    const reasonCodes: RankedIssue["reasonCodes"] = [];
    if (candidate.matchedCardCodes.length > 0) reasonCodes.push("INTEREST_MATCH");
    if (candidate.components.exploration > 0) reasonCodes.push("EXPLORATION");
    if (reasonCodes.length === 0) reasonCodes.push("RECENT_FALLBACK");
    result.push({
      ...candidate.issue,
      score: candidate.score,
      qualityScore: candidate.score,
      explorationScore: candidate.components.exploration,
      reasonCodes,
      matchedCardCodes: candidate.matchedCardCodes,
      candidateSources: candidate.candidateSources,
      scoreComponents: candidate.components,
      controversyEligible: candidate.controversyEligible,
      shadowPosition: result.length + 1,
      qualityEligible: candidate.qualityEligible,
      eligibilityReasons: candidate.eligibilityReasons,
    });
  }
  return result;
}

export function attachShadowRanking(served: RankedIssue[], shadow: RankedIssue[]) {
  const shadowById = new Map(shadow.map((item, index) => [item.id, { item, position: index + 1 }]));
  return served.map((item) => {
    const quality = shadowById.get(item.id);
    return quality
      ? { ...item, ...quality.item, score: item.score, shadowPosition: quality.position }
      : item;
  });
}
