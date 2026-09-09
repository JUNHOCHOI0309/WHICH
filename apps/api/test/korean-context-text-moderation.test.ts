import { describe, expect, it } from "vitest";

import {
  createKoreanContextTextModerator,
  koreanContextTextModelMetadata,
} from "../src/modules/text-moderation/service.js";

describe("Korean context text moderation", () => {
  const moderator = createKoreanContextTextModerator();

  it("allows ordinary participation text", () => {
    const result = moderator.moderate({
      target: "오늘 저녁은 치킨이 좋아요",
      context: "야식으로 무엇을 먹을까요?",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.score).toBeLessThan(result.thresholds.review);
  });

  it("blocks severe targeted abuse", () => {
    const result = moderator.moderate({
      target: "너 같은 쓰레기 새끼는 당장 죽어버려",
      context: "의견이 다를 수 있다고 생각해요",
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.score).toBeGreaterThanOrEqual(result.thresholds.block);
  });

  it("does not copy a harmful parent decision onto a respectful response", () => {
    const result = moderator.moderate({
      target: "그 말은 너무 심했어. 서로 존중하자",
      context: "너는 정말 쓸모없는 인간이야",
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("ships thresholds backed by the held-out conversation split", () => {
    expect(koreanContextTextModelMetadata.validation.validationSamples).toBe(45_215);
    expect(koreanContextTextModelMetadata.validation.review.precision).toBeGreaterThanOrEqual(0.95);
    expect(koreanContextTextModelMetadata.validation.review.falsePositiveRate).toBeLessThanOrEqual(
      0.01,
    );
    expect(koreanContextTextModelMetadata.validation.block.falsePositiveRate).toBeLessThan(0.001);
  });
});
