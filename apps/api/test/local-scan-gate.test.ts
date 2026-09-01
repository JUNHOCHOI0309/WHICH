import { describe, expect, it } from "vitest";
import { EMBEDDED_TEXT_VERSION } from "../src/modules/issue-media/embedded-text.js";
import type { ModerationProviderInput } from "../src/modules/moderation-providers/contracts.js";
import { requireCompletePrivateLocalScan } from "../src/modules/moderation-providers/local-scan-gate.js";

const image = {
  dataUrl: "data:image/webp;base64,AA==",
  mimeType: "image/webp" as const,
  width: 1,
  height: 1,
  byteLength: 1,
  metadataStripped: true as const,
  reencoded: true as const,
};
const input = (status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "WITHHELD_PII") =>
  ({
    targetType: "ISSUE_VERSION",
    scope: "SUBMISSION_REVISION",
    modality: "TEXT_AND_IMAGE",
    images: [image, image],
    embeddedText: {
      version: EMBEDDED_TEXT_VERSION,
      images: [
        { normalizedHash: "a".repeat(64), status: "COMPLETE", characters: 0 },
        { normalizedHash: "b".repeat(64), status, characters: 0 },
      ],
    },
  }) satisfies ModerationProviderInput;

describe("private local scan publication gate", () => {
  it("accepts only a complete two-image scan", () => {
    expect(() => requireCompletePrivateLocalScan(input("COMPLETE"))).not.toThrow();
  });

  it.each([
    ["PARTIAL", "LOCAL_SCAN_PARTIAL"],
    ["UNAVAILABLE", "LOCAL_SCAN_UNAVAILABLE"],
    ["WITHHELD_PII", "LOCAL_SCAN_PII_WITHHELD"],
  ] as const)("classifies %s without making it retryable", (status, code) => {
    expect(() => requireCompletePrivateLocalScan(input(status))).toThrow(
      `INPUT_UNAVAILABLE:${code}`,
    );
  });
});
