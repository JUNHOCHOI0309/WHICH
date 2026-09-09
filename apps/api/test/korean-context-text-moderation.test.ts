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

  it.each([
    ["DEHUMANIZING_SLUR", "윤석열은 내란견인가?", "내란을 주도한 악마새끼인가요?"],
    ["EXPLICIT_SEXUAL_SLUR", "섹시자지보지?", "윤석열 노무현 이명박 박근혜 레츠고"],
    [
      "SEXUALIZED_PERSON_REFERENCE",
      "이재명은 중국의 시진핑 주석의 자지를 사랑합니까?",
      "중요한 질문입니다.",
    ],
  ])("blocks a production false negative with rule %s", (ruleId, target, context) => {
    const result = moderator.moderate({ target, context });
    expect(result).toMatchObject({
      decision: "BLOCK",
      decisionSource: "HIGH_PRECISION_RULE",
      ruleId,
    });
  });

  it.each([
    ["오늘은 피곤하지만 낮잠을 자지 않았어요", "생활 습관을 이야기합니다"],
    ["아직 그 영화를 보지 못했어요", "이번 주말 영화 이야기"],
    ["'내란견'이라는 비하 표현을 신고합니다", "신고 사유를 작성합니다"],
    ["'자지'는 성기를 낮춰 부르는 비속어입니다", "성교육 자료의 표현 설명"],
  ])("does not force-block an ambiguous or reporting use", (target, context) => {
    const result = moderator.moderate({ target, context });
    expect(result.decisionSource).toBe("MODEL");
    expect(result.ruleId).toBeNull();
  });

  it("does not copy a harmful parent decision onto a respectful response", () => {
    const result = moderator.moderate({
      target: "그 말은 너무 심했어. 서로 존중하자",
      context: "너는 정말 쓸모없는 인간이야",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.decisionSource).toBe("MODEL");
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
