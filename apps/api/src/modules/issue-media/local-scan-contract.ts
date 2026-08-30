import { z } from "zod";
import { OCR_PII_KINDS } from "./ocr-pii.js";

export const LOCAL_SCAN_VERSION = "which-local-tesseract7-zxing3-v1";
export const LOCAL_SCAN_MAX_BYTES = 10 * 1024 * 1024;
export const LOCAL_SCAN_MAX_PIXELS = 1600 * 1600;
export const LOCAL_SCAN_FAILURES = [
  "DISABLED",
  "BUSY",
  "TIMEOUT",
  "INPUT_LIMIT",
  "INVALID_IMAGE",
  "ENGINE_FAILURE",
  "INVALID_OUTPUT",
] as const;
export type LocalScanFailure = (typeof LOCAL_SCAN_FAILURES)[number];
const status = z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]);
const codeScan = z.object({ status, detected: z.boolean() }).strict();
export const localScanResultSchema = z
  .object({
    detectorVersion: z.literal(LOCAL_SCAN_VERSION),
    qr: codeScan,
    barcode: codeScan,
    ocr: z.object({ status, piiKinds: z.array(z.enum(OCR_PII_KINDS)).max(4) }).strict(),
    // These capabilities are not implemented by OCR or barcode libraries.
    visual: z
      .object({
        status: z.literal("UNAVAILABLE"),
        faceDetected: z.literal(false),
        identityDocumentDetected: z.literal(false),
        screenshotDetected: z.literal(false),
      })
      .strict(),
    failureCode: z.enum(LOCAL_SCAN_FAILURES).optional(),
  })
  .strict();
export type LocalScanResult = z.infer<typeof localScanResultSchema>;
export function incompleteLocalScan(failureCode: LocalScanFailure): LocalScanResult {
  return {
    detectorVersion: LOCAL_SCAN_VERSION,
    qr: { status: "UNAVAILABLE", detected: false },
    barcode: { status: "UNAVAILABLE", detected: false },
    ocr: { status: "UNAVAILABLE", piiKinds: [] },
    visual: {
      status: "UNAVAILABLE",
      faceDetected: false,
      identityDocumentDetected: false,
      screenshotDetected: false,
    },
    failureCode,
  };
}
