import { describe, expect, it } from "vitest";

import {
  policyJudgeReviewNote,
  safetySignalReviewNote,
} from "../src/modules/moderation-dispatch/submission-review-note.js";

const decision = {
  decision: "BLOCK",
  reason_codes: ["SEXUAL"],
  image_relevance: "RELATED",
  pair_fairness: "BALANCED",
  privacy_risk: "LOW",
  rights_risk: "UNCERTAIN",
  needs_human: false,
};

describe("submission review notes", () => {
  it("explains a sexual-content block without exposing internal labels or scores", () => {
    const note = policyJudgeReviewNote(decision);
    expect(note).toContain("선정성 기준");
    expect(note).toContain("A/B 이미지 중 하나 이상");
    expect(note).not.toContain("SEXUAL");
  });

  it("lists each actionable reason once", () => {
    const note = policyJudgeReviewNote({
      ...decision,
      decision: "REVIEW",
      reason_codes: ["PRIVACY", "IRRELEVANT", "PRIVACY"],
      image_relevance: "UNRELATED",
      privacy_risk: "HIGH",
      needs_human: true,
    });
    expect(note).toContain("개인정보 노출 가능성");
    expect(note).toContain("관련성 부족");
    expect(note.match(/개인정보 노출 가능성/gu)).toHaveLength(1);
  });

  it("keeps malformed or unsupported decisions fail-closed and generic", () => {
    expect(policyJudgeReviewNote({ reason_codes: ["UNKNOWN"] })).toContain("충분히 확인하지 못해");
  });

  it("maps flagged safety signals without revealing provider labels", () => {
    const note = safetySignalReviewNote([
      { flagged: true, canonicalCode: "CONTENT_SELF_HARM", providerLabel: "self-harm/intent" },
    ]);
    expect(note).toContain("자해 관련 유해 콘텐츠");
    expect(note).not.toContain("self-harm");
  });
});
