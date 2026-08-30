import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { createLocalMediaSignalDetector } from "../src/modules/issue-media/local-scan-detector.js";
import { evaluateLocalMediaInspection } from "../src/modules/issue-media/upload-gate-policy.js";
import { detectOcrPiiKinds } from "../src/modules/issue-media/ocr-pii.js";

const require = createRequire(import.meta.url);
const detector = createLocalMediaSignalDetector({
  enabled: true,
  timeoutMs: 30000,
  workerUrl: new URL("../src/local-media-scanner.ts", import.meta.url),
  execArgv: ["--import", "tsx"],
});

describe("real local OCR and barcode engines", () => {
  it("extracts only PII categories from actual image pixels", async () => {
    const image = await sharp(
      Buffer.from(
        '<svg width="1000" height="200"><rect width="100%" height="100%" fill="white"/><text x="30" y="70" font-size="42" font-family="sans-serif">support@example.com</text><text x="30" y="145" font-size="42" font-family="sans-serif">010-1234-5678</text></svg>',
      ),
    )
      .webp({ lossless: true })
      .toBuffer();
    const result = await detector.inspect(image);
    expect(result.ocr.status).not.toBe("UNAVAILABLE");
    expect(result.ocr.piiKinds).toEqual(expect.arrayContaining(["EMAIL", "PHONE"]));
    expect(result.ocr.text).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("support@example.com");
    expect(JSON.stringify(result)).not.toContain("010-1234-5678");
    expect(
      evaluateLocalMediaInspection({
        sha256: "a".repeat(64),
        perceptualHash: "0".repeat(16),
        detector: result,
        inspectionComplete: false,
      }).signals,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MEDIA_OCR_PII_DETECTED" })]),
    );
  }, 45000);

  it.each(["QRCode", "Code128"] as const)(
    "detects %s without returning or following its payload",
    async (format) => {
      await prepareZXingModule({
        overrides: {
          wasmBinary: new Uint8Array(
            await readFile(require.resolve("zxing-wasm/writer/zxing_writer.wasm")),
          ).buffer,
        },
        fireImmediately: true,
      });
      const payload = "http://127.0.0.1";
      const encoded = await writeBarcode(payload, { format, scale: 4 });
      expect(encoded.error).toBe("");
      const image = await sharp(Buffer.from(await encoded.image!.arrayBuffer()))
        .webp({ lossless: true })
        .toBuffer();
      const result = await detector.inspect(image);
      expect(format === "QRCode" ? result.qr.detected : result.barcode.detected).toBe(true);
      expect(JSON.stringify(result)).not.toContain(payload);
      expect(result.visual.status).toBe("UNAVAILABLE");
    },
    45000,
  );

  it("does not claim visual safety for a blank image", async () => {
    const image = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer();
    const result = await detector.inspect(image);
    expect(result.qr).toEqual({ status: "COMPLETE", detected: false });
    expect(result.ocr).toEqual({ status: "COMPLETE", piiKinds: [] });
    expect(result.visual.status).toBe("UNAVAILABLE");
    expect(
      evaluateLocalMediaInspection({
        sha256: "a".repeat(64),
        perceptualHash: "0".repeat(16),
        detector: result,
        inspectionComplete: false,
      }).decision,
    ).toBe("REVIEW_REQUIRED");
  }, 45000);

  it("rejects corrupt and oversized decoded inputs without classifying them as safe", async () => {
    expect(await detector.inspect(Buffer.from("not an image"))).toMatchObject({
      failureCode: "INVALID_IMAGE",
      ocr: { status: "UNAVAILABLE" },
    });
    const image = await sharp({
      create: { width: 1700, height: 100, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer();
    expect(await detector.inspect(image)).toMatchObject({ failureCode: "INVALID_IMAGE" });
  }, 45000);

  it("normalizes common OCR separators without retaining matched values", () => {
    expect(
      detectOcrPiiKinds("test @ example . com +82 10-1234-5678 ９００１０１－１２３４５６７"),
    ).toEqual(expect.arrayContaining(["EMAIL", "PHONE", "NATIONAL_ID"]));
    expect(detectOcrPiiKinds("Which is your favorite season?")).toEqual([]);
  });
});
