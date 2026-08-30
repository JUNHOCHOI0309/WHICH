import { describe, expect, it } from "vitest";
import {
  EMBEDDED_TEXT_VERSION,
  minimizeEmbeddedText,
} from "../src/modules/issue-media/embedded-text.js";
import { moderationProviderCacheHash } from "../src/modules/moderation-providers/input-binding.js";
import { createOpenAiModerationAdapter } from "../src/modules/moderation-providers/openai-moderation-adapter.js";

describe("ephemeral image text", () => {
  it.each(["test @ example . com", "010-1234-5678", "９００１０１－１２３４５６７", "123-456-789"])(
    "withholds detected PII: %s",
    (raw) => {
      expect(minimizeEmbeddedText(raw, "COMPLETE")).toEqual({
        version: EMBEDDED_TEXT_VERSION,
        status: "WITHHELD_PII",
        text: "",
      });
    },
  );
  it("minimizes links and control characters, marks truncation, and never invents a completed scan", () => {
    expect(
      minimizeEmbeddedText(" Hello\u200B\nhttps://example.test/a World ", "COMPLETE").text,
    ).toBe("Hello [URL_REDACTED] World");
    expect(minimizeEmbeddedText("a".repeat(2001), "COMPLETE")).toMatchObject({
      status: "PARTIAL",
      text: "a".repeat(2000),
    });
    expect(minimizeEmbeddedText("secret", "UNAVAILABLE").text).toBe("");
    expect(minimizeEmbeddedText("", "PARTIAL").status).toBe("PARTIAL");
  });
  it("isolates OCR mode/contract caches and refuses partial or unbound image evidence", () => {
    const target = { targetType: "ISSUE_VERSION" as const, normalizedInputHash: "a".repeat(64) };
    expect(
      new Set(
        [undefined, "embedded-v1:OFF", "embedded-v1:LOCAL", "embedded-v2:LOCAL"].map(
          (cacheProfile) => moderationProviderCacheHash({ ...target, cacheProfile }),
        ),
      ).size,
    ).toBe(4);
    const adapter = createOpenAiModerationAdapter({
      apiKey: "mock",
      embeddedTextEnabled: true,
      resolveInput: () => {
        throw Error("no API call permitted");
      },
    });
    expect(adapter.canReuseResult!({ imageCount: 2 })).toBe(false);
    const images = ["a", "b"].map((hash) => ({
      normalizedHash: hash.repeat(64),
      status: "COMPLETE",
      characters: 0,
    }));
    expect(
      adapter.canReuseResult!({
        imageCount: 2,
        embeddedText: { version: EMBEDDED_TEXT_VERSION, images },
      }),
    ).toBe(true);
    for (const status of ["PARTIAL", "UNAVAILABLE", "WITHHELD_PII"]) {
      expect(
        adapter.canReuseResult!({
          imageCount: 2,
          embeddedText: {
            version: EMBEDDED_TEXT_VERSION,
            images: [{ ...images[0], status }, images[1]],
          },
        }),
      ).toBe(false);
    }
  });
});
