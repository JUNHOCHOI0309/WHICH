import { createHash } from "node:crypto";

import type { InterestCardCode } from "../interests/contracts.js";
import type { RankableIssue, RankedIssue } from "./contracts.js";

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
      return {
        ...issue,
        score: matchScore * 10 + explorationScore,
        explorationScore,
        reasonCodes,
        matchedCardCodes,
      };
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

      return {
        ...issue,
        score: defaultTopicBoost + explorationScore,
        explorationScore,
        reasonCodes,
        matchedCardCodes: [],
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.publishedAt.valueOf() - left.publishedAt.valueOf() ||
        right.id.localeCompare(left.id),
    );
}
