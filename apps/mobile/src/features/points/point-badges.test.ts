import { describe, expect, it } from "vitest";

import { nextPointBadge, pointBadgeFor, pointBadgeProgress } from "./point-badges";

describe("W Point cumulative badges", () => {
  it.each([
    [-10, "BRONZE"],
    [0, "BRONZE"],
    [999, "BRONZE"],
    [1_000, "SILVER"],
    [2_500, "GOLD"],
    [5_000, "PLATINUM"],
    [10_000, "DIAMOND"],
  ])("maps %i lifetime points to %s", (points, code) => {
    expect(pointBadgeFor(points).code).toBe(code);
  });

  it("returns the next milestone and a bounded progress ratio", () => {
    expect(nextPointBadge(1_500)?.code).toBe("GOLD");
    expect(pointBadgeProgress(1_750)).toBe(0.5);
    expect(nextPointBadge(20_000)).toBeNull();
    expect(pointBadgeProgress(20_000)).toBe(1);
  });
});
