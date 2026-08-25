import { describe, expect, it } from "vitest";

import type { RankableIssue } from "../src/modules/recommendations/contracts.js";
import { rankDiscoveryIssues, rankIssues } from "../src/modules/recommendations/ranker.js";

function issue(
  id: string,
  cardWeights: RankableIssue["cardWeights"],
  publishedAt = new Date("2026-08-25T00:00:00.000Z"),
): RankableIssue {
  return { id, version: 1, publishedAt, cardWeights };
}

describe("refresh-diverse recommendation ranking", () => {
  it("changes equal-interest ordering by refresh seed without letting non-matches outrank matches", () => {
    const candidates = [
      issue("match-1", new Map([["TECH", 100]])),
      issue("match-2", new Map([["TECH", 100]])),
      issue("match-3", new Map([["TECH", 100]])),
      issue("non-match", new Map([["FOOD", 100]])),
    ];

    const first = rankIssues(candidates, ["TECH"], "subject", 1, "refresh-a");
    const second = rankIssues(candidates, ["TECH"], "subject", 1, "refresh-b");

    expect(first.slice(0, 3).every((item) => item.matchedCardCodes.includes("TECH"))).toBe(true);
    expect(second.slice(0, 3).every((item) => item.matchedCardCodes.includes("TECH"))).toBe(true);
    expect(first.map((item) => item.id)).not.toEqual(second.map((item) => item.id));
  });

  it("boosts society and daily-life discovery candidates while retaining other topics", () => {
    const ranked = rankDiscoveryIssues(
      [
        issue("society", new Map([["SOCIETY", 100]])),
        issue("daily", new Map([["DAILY_LIFE", 100]])),
        issue("other", new Map([["FOOD", 100]])),
      ],
      "seed-a",
    );

    expect(ranked.map((item) => item.id)).toEqual(["society", "daily", "other"]);
    expect(ranked[0]?.reasonCodes).toContain("DEFAULT_TOPIC_BOOST");
    expect(ranked[1]?.reasonCodes).toContain("DEFAULT_TOPIC_BOOST");
    expect(ranked[2]?.reasonCodes).not.toContain("DEFAULT_TOPIC_BOOST");
    expect(ranked).toHaveLength(3);
  });
});
