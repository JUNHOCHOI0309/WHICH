import sharp, { type Metadata } from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { processIssueMedia } from "../src/modules/issue-media/image-processing.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Issue image normalization backpressure", () => {
  it("holds processing slots after a caller timeout until native work settles", async () => {
    const unsupportedImage = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#fff" },
    })
      .gif()
      .toBuffer();
    const unsupportedMetadata = await sharp(unsupportedImage).metadata();
    vi.useFakeTimers();
    const release: Array<(value: Metadata) => void> = [];
    const metadata = vi
      .spyOn(sharp.prototype, "metadata")
      .mockImplementation(() => new Promise<Metadata>((resolve) => release.push(resolve)));
    const first = processIssueMedia(Buffer.from("first"), "image/png").catch(
      (error: unknown) => error,
    );
    const second = processIssueMedia(Buffer.from("second"), "image/png").catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toMatchObject({ code: "MEDIA_PROCESSING_TIMEOUT" });
    expect(await second).toMatchObject({ code: "MEDIA_PROCESSING_TIMEOUT" });
    await expect(processIssueMedia(Buffer.from("third"), "image/png")).rejects.toMatchObject({
      code: "MEDIA_PROCESSING_BUSY",
    });
    for (const resolve of release) resolve(unsupportedMetadata);
    await vi.advanceTimersByTimeAsync(0);
    metadata.mockResolvedValue(unsupportedMetadata);
    await expect(processIssueMedia(Buffer.from("fourth"), "image/png")).rejects.toMatchObject({
      code: "MEDIA_FORMAT_UNSUPPORTED",
    });
  });
});
