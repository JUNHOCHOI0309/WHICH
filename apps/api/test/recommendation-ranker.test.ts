import { describe, expect, it } from "vitest";

import type { RankableIssue } from "../src/modules/recommendations/contracts.js";
import {
  attachShadowRanking,
  rankDiscoveryIssues,
  rankIssues,
  rankQualityIssues,
} from "../src/modules/recommendations/ranker.js";

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

describe("quality feed v1", () => {
  const now = new Date("2026-08-26T00:00:00.000Z");

  function qualityIssue(id: string, overrides: Partial<RankableIssue> = {}): RankableIssue {
    return {
      id,
      version: 1,
      publishedAt: new Date("2026-08-25T12:00:00.000Z"),
      cardWeights: new Map([["DAILY_LIFE", 100]]),
      categoryCode: "DAILY_LIFE",
      authorId: `author-${id}`,
      contentHash: `hash-${id}`,
      question: `${id} 상황에서 어느 쪽을 고르시겠어요?`,
      context: "일상에서 실제로 고민할 만한 상황입니다.",
      choiceLabels: ["첫 번째 선택", "두 번째 선택"],
      qualitySignals: {
        viewableImpressions: 100,
        acceptedA: 28,
        acceptedB: 24,
        averageDecisionMs: 5_000,
        nextIssueOpens: 30,
        commentCompletions: 8,
        shareCompletions: 4,
        skips: 6,
        reports: 0,
      },
      ...overrides,
    };
  }

  it("uses conversion, decision, next, conversation, skip and report signals as components", () => {
    const [ranked] = rankQualityIssues(
      [qualityIssue("healthy")],
      ["DAILY_LIFE"],
      "stable-seed",
      now,
    );

    expect(ranked?.candidateSources).toEqual(
      expect.arrayContaining(["INTEREST", "FRESH", "EDITORIAL_QUALITY", "BEHAVIOR_QUALITY"]),
    );
    expect(ranked?.scoreComponents.behavior).toBeGreaterThan(0);
    expect(ranked?.scoreComponents.safetyPenalty).toBeGreaterThan(0);
    expect(ranked?.controversyEligible).toBe(true);
  });

  it("does not make 50:50 balance or raw volume sufficient for controversy", () => {
    const [lowConversion] = rankQualityIssues(
      [
        qualityIssue("balanced-but-skipped", {
          qualitySignals: {
            viewableImpressions: 1_000,
            acceptedA: 10,
            acceptedB: 10,
            averageDecisionMs: 250,
            nextIssueOpens: 0,
            commentCompletions: 0,
            shareCompletions: 0,
            skips: 800,
            reports: 5,
          },
        }),
      ],
      [],
      "stable-seed",
      now,
    );

    expect(lowConversion?.controversyEligible).toBe(false);
    expect(lowConversion?.qualityEligible).toBe(false);
    expect(lowConversion?.eligibilityReasons).toEqual(
      expect.arrayContaining(["EXCESSIVE_SKIP", "REPORT_RISK"]),
    );
  });

  it("limits repeated topic, author and near-duplicate concentration", () => {
    const ranked = rankQualityIssues(
      [
        qualityIssue("one", { authorId: "same-author", categoryCode: "FOOD" }),
        qualityIssue("two", { authorId: "same-author", categoryCode: "FOOD" }),
        qualityIssue("three", { authorId: "same-author", categoryCode: "FOOD" }),
        qualityIssue("different", { categoryCode: "TRAVEL" }),
        qualityIssue("duplicate", { contentHash: "hash-one" }),
      ],
      ["DAILY_LIFE"],
      "stable-seed",
      now,
    );

    expect(ranked.slice(0, 4).map((item) => item.id)).toContain("different");
    expect(
      Math.max(
        ranked.findIndex((item) => item.id === "duplicate"),
        ranked.findIndex((item) => item.id === "one"),
      ),
    ).toBe(ranked.length - 1);
  });

  it("attaches shadow positions without changing served order", () => {
    const served = rankIssues(
      [qualityIssue("served-first"), qualityIssue("served-second")],
      ["DAILY_LIFE"],
      "subject",
      1,
      "legacy-seed",
    );
    const shadow = [...served].reverse();
    const audited = attachShadowRanking(served, shadow);

    expect(audited.map((item) => item.id)).toEqual(served.map((item) => item.id));
    expect(audited.map((item) => item.shadowPosition)).toEqual([2, 1]);
  });
});
