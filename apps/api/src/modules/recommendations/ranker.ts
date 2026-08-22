import { createHash } from "node:crypto";

import type { InterestCardCode } from "../interests/contracts.js";
import type { RankableIssue, RankedIssue } from "./contracts.js";

function stableExplorationScore(
  subjectId: string | null,
  profileVersion: number | null,
  issueId: string,
) {
  if (!subjectId || !profileVersion) return 0;
  const digest = createHash("sha256").update(`${subjectId}:${profileVersion}:${issueId}`).digest();
  return digest[0]! % 5;
}

export function rankIssues(
  issues: RankableIssue[],
  selectedCardCodes: InterestCardCode[],
  subjectId: string | null,
  profileVersion: number | null,
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
      const explorationScore = stableExplorationScore(subjectId, profileVersion, issue.id);
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
