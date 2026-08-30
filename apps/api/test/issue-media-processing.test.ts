import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ISSUE_MEDIA_PROCESSING_POLICY,
  processIssueMedia,
} from "../src/modules/issue-media/image-processing.js";

async function graphic(width: number, height: number) {
  return sharp(
    Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><rect x="0" y="0" width="20%" height="100%" fill="#08a0b0"/><rect x="80%" y="0" width="20%" height="100%" fill="#ff6730"/><text x="22%" y="35%" font-size="20" fill="#102128">WHICH - Fine text 010-1234-5678</text><text x="22%" y="40%" font-size="14" fill="#102128">A / B / 2026 / image safety</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

describe("Issue media responsive storage optimization", () => {
  it.each([
    [2400, 3000, 1024, 1280],
    [2560, 1440, 1280, 720],
    [1800, 1800, 1280, 1280],
  ])(
    "fits %ix%i inside 1280 without cropping or stretching",
    async (width, height, expectedWidth, expectedHeight) => {
      const input = await graphic(width, height);
      const result = await processIssueMedia(input, "image/png");
      expect(result.output).toMatchObject({
        width: expectedWidth,
        height: expectedHeight,
        mimeType: "image/webp",
      });
      expect(result.output.byteSize).toBe(result.body.length);
      expect(result.sha256).toBe(createHash("sha256").update(input).digest("hex"));
      expect(result.optimization).toMatchObject({
        policyVersion: "which-issue-media-webp-v2",
        maxOutputEdge: 1280,
      });
      const pixels = await sharp(result.body).removeAlpha().raw().toBuffer();
      // Both colored edges survive: this is not a centre crop to a screen ratio.
      expect([...pixels.subarray(0, 3)]).toEqual([8, 160, 176]);
      expect([...pixels.subarray((expectedWidth - 1) * 3, expectedWidth * 3)]).toEqual([
        255, 103, 48,
      ]);
    },
  );

  it("never enlarges small uploads", async () => {
    const result = await processIssueMedia(await graphic(320, 400), "image/png");
    expect(result.output).toMatchObject({ width: 320, height: 400 });
  });

  it("chooses the smaller lossless encoding for flat/text graphics without changing decoded pixels", async () => {
    const input = await graphic(1024, 1280);
    const result = await processIssueMedia(input, "image/png");
    expect(result.optimization).toMatchObject({ encoding: "LOSSLESS", quality: null });
    const reference = await sharp(input).toColourspace("srgb").removeAlpha().raw().toBuffer();
    const actual = await sharp(result.body).removeAlpha().raw().toBuffer();
    expect(actual.equals(reference)).toBe(true);
    const legacy = await sharp(input)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 5, smartSubsample: true })
      .toBuffer();
    expect(result.body.length).toBeLessThan(legacy.length);
  });

  it("preserves transparent pixels and removes metadata even for WebP input", async () => {
    const input = await sharp({
      create: {
        width: 64,
        height: 80,
        channels: 4,
        background: { r: 20, g: 100, b: 180, alpha: 0.5 },
      },
    })
      .withMetadata({ exif: { IFD0: { Artist: "test-private-author" } } })
      .webp({ lossless: true })
      .toBuffer();
    const result = await processIssueMedia(input, "image/webp");
    const metadata = await sharp(result.body).metadata();
    expect(metadata).toMatchObject({ hasAlpha: true, width: 64, height: 80, format: "webp" });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    const alpha = await sharp(result.body).extractChannel("alpha").raw().toBuffer();
    expect(new Set(alpha)).toEqual(new Set([128]));
  });

  it("corrects EXIF orientation before fitting and preserves source identity", async () => {
    const input = await sharp(await graphic(2400, 1200))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await processIssueMedia(input, "image/jpeg");
    expect(result.input).toMatchObject({ width: 2400, height: 1200 });
    expect(result.output).toMatchObject({ width: 640, height: 1280 });
    expect(result.optimization).toMatchObject({
      encoding: "LOSSY",
      quality: ISSUE_MEDIA_PROCESSING_POLICY.quality,
    });
    expect((await sharp(result.body).metadata()).orientation).toBeUndefined();
  });

  // Fixture generation, both encoders and PSNR analysis share this test budget.
  // Keep the production processor's independent 10-second deadline unchanged.
  it(
    "reduces a deterministic photo-like JPEG versus the old 1600px/84 policy",
    { timeout: 30_000 },
    async () => {
      const width = 1600,
        height = 2000;
      const pixels = Buffer.alloc(width * height * 3);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 3;
          pixels[offset] = Math.round(110 + 65 * Math.sin(x / 31) + 30 * Math.cos(y / 41));
          pixels[offset + 1] = Math.round(120 + 50 * Math.sin(y / 21) + 30 * Math.cos(x / 54));
          pixels[offset + 2] = Math.round(
            115 + 55 * Math.sin((x + y) / 35) + 25 * Math.cos(x / 11),
          );
        }
      }
      const input = await sharp(pixels, { raw: { width, height, channels: 3 } })
        .jpeg({ quality: 95 })
        .toBuffer();
      const result = await processIssueMedia(input, "image/jpeg");
      const legacy = await sharp(input)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84, effort: 5, smartSubsample: true })
        .toBuffer();
      expect(result.body.length).toBeLessThan(legacy.length * 0.85);
      const reference = await sharp(input)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: "inside" })
        .toColourspace("srgb")
        .raw()
        .toBuffer();
      const decoded = await sharp(result.body).raw().toBuffer();
      expect(decoded.length).toBe(reference.length);
      let squaredError = 0;
      for (let index = 0; index < decoded.length; index++)
        squaredError += (decoded[index]! - reference[index]!) ** 2;
      const psnr = 10 * Math.log10(255 ** 2 / (squaredError / decoded.length));
      expect(psnr).toBeGreaterThan(32);
    },
  );

  it("keeps size and MIME checks in front of optimization", async () => {
    await expect(processIssueMedia(Buffer.alloc(0), "image/png")).rejects.toMatchObject({
      code: "MEDIA_EMPTY",
    });
    await expect(
      processIssueMedia(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png"),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
    await expect(processIssueMedia(await graphic(32, 32), "image/jpeg")).rejects.toMatchObject({
      code: "MEDIA_MIME_MISMATCH",
    });
    await expect(processIssueMedia(Buffer.from("not an image"), "image/png")).rejects.toMatchObject(
      { code: "MEDIA_PROCESSING_FAILED" },
    );
  });
});
