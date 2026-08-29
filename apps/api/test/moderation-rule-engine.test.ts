import { describe, expect, it } from "vitest";

import {
  evaluateTextRules,
  normalizeModerationText,
  TRUST_TIER_WINDOWS,
} from "../src/modules/moderation/rule-engine.js";

describe("common moderation rule engine", () => {
  it("normalizes Unicode, line endings, and whitespace consistently", () => {
    expect(normalizeModerationText("  A\r\n  B   C  ", "INLINE")).toBe("A B C");
    expect(normalizeModerationText("  A\r\n  B   C  ", "MULTILINE")).toBe("A\n B C");
    expect(normalizeModerationText("e\u0301", "INLINE")).toBe("é");
  });

  it("emits stable block and review signals without exposing matched PII", () => {
    const result = evaluateTextRules({
      value: "문의 test@example.com https://example.com 반복 반복 반복 반복 반복 반복",
      minimumLength: 2,
      maximumLength: 500,
      allowUrls: false,
      trustTier: "MEMBER",
    });
    expect(result.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "TEXT_URL_PRESENT",
        "PRIVACY_EMAIL_DETECTED",
        "TEXT_TOKEN_REPETITION",
      ]),
    );
    expect(JSON.stringify(result.signals)).not.toContain("test@example.com");
    expect(result.window).toEqual(TRUST_TIER_WINDOWS.MEMBER);
  });

  it("uses explicit trust-tier action windows", () => {
    expect(TRUST_TIER_WINDOWS.GUEST.maximumActions).toBeLessThan(
      TRUST_TIER_WINDOWS.TRUSTED.maximumActions,
    );
    expect(TRUST_TIER_WINDOWS.OPERATOR.maximumActions).toBeGreaterThan(
      TRUST_TIER_WINDOWS.MEMBER.maximumActions,
    );
  });
});
