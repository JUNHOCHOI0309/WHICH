import { describe, expect, it } from "vitest";

import { calculateChoiceDistribution } from "../src/modules/voting/choice-distribution.js";

describe("PICK Choice distribution metrics", () => {
  it("keeps a balanced binary Issue comparable with the future PICK metric", () => {
    expect(
      calculateChoiceDistribution([
        { choiceId: "a", acceptedCount: 50 },
        { choiceId: "b", acceptedCount: 50 },
      ]),
    ).toEqual({ displayedTotal: 100, topTwoGapRatio: 0, normalizedEntropy: 1 });
  });

  it("reports maximum entropy for an evenly distributed four-Choice Issue", () => {
    const distribution = calculateChoiceDistribution([
      { choiceId: "a", acceptedCount: 25 },
      { choiceId: "b", acceptedCount: 25 },
      { choiceId: "c", acceptedCount: 25 },
      { choiceId: "d", acceptedCount: 25 },
    ]);

    expect(distribution.displayedTotal).toBe(100);
    expect(distribution.topTwoGapRatio).toBe(0);
    expect(distribution.normalizedEntropy).toBeCloseTo(1, 10);
  });

  it("uses the first and second ranked Choices for the primary gap", () => {
    const distribution = calculateChoiceDistribution([
      { choiceId: "a", acceptedCount: 70 },
      { choiceId: "b", acceptedCount: 20 },
      { choiceId: "c", acceptedCount: 10 },
    ]);

    expect(distribution.topTwoGapRatio).toBe(0.5);
    expect(distribution.normalizedEntropy).toBeCloseTo(0.7298466992, 10);
  });

  it("returns unavailable distribution metrics before the first accepted Vote", () => {
    expect(
      calculateChoiceDistribution([
        { choiceId: "a", acceptedCount: 0 },
        { choiceId: "b", acceptedCount: 0 },
        { choiceId: "c", acceptedCount: 0 },
      ]),
    ).toEqual({ displayedTotal: 0, topTwoGapRatio: null, normalizedEntropy: null });
  });

  it("rejects cardinality, duplicate identity, and invalid count violations", () => {
    expect(() => calculateChoiceDistribution([{ choiceId: "a", acceptedCount: 1 }])).toThrow(
      RangeError,
    );
    expect(() =>
      calculateChoiceDistribution([
        { choiceId: "a", acceptedCount: 1 },
        { choiceId: "a", acceptedCount: 2 },
      ]),
    ).toThrow(TypeError);
    expect(() =>
      calculateChoiceDistribution([
        { choiceId: "a", acceptedCount: 1 },
        { choiceId: "b", acceptedCount: -1 },
      ]),
    ).toThrow(RangeError);
  });
});
