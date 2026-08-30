import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { createWorker, OEM, PSM } from "tesseract.js";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { detectOcrPiiKinds } from "./ocr-pii.js";
import { minimizeEmbeddedText, type EmbeddedText } from "./embedded-text.js";
import {
  incompleteLocalScan,
  LOCAL_SCAN_MAX_BYTES,
  LOCAL_SCAN_MAX_PIXELS,
  type LocalScanResult,
} from "./local-scan-contract.js";

const require = createRequire(import.meta.url);
const languagePath = (code: "eng" | "kor") =>
  join(
    dirname(require.resolve(`@tesseract.js-data/${code}`)),
    "4.0.0_best_int",
    `${code}.traineddata.gz`,
  );

export async function localScanResources() {
  const paths = [
    require.resolve("zxing-wasm/reader/zxing_reader.wasm"),
    languagePath("eng"),
    languagePath("kor"),
  ];
  return Promise.all(paths.map((path) => readFile(path)));
}

// Run only inside the disposable local scanner process. No image, OCR text, decoded URL,
// or barcode content is saved to disk or logged. The opt-in callback receives only a bounded,
// minimized text projection for transient moderation input; ordinary upload scans return none.
export async function scanLocalImage(
  bytes: Buffer,
  receiveText?: (text: EmbeddedText) => void,
): Promise<LocalScanResult> {
  if (!bytes.length || bytes.length > LOCAL_SCAN_MAX_BYTES)
    return incompleteLocalScan("INPUT_LIMIT");
  const result = incompleteLocalScan("ENGINE_FAILURE");
  let png: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: LOCAL_SCAN_MAX_PIXELS, failOn: "warning" });
    const meta = await image.metadata();
    if (
      meta.format !== "webp" ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) !== 1 ||
      meta.width > 1600 ||
      meta.height > 1600
    ) {
      return incompleteLocalScan("INVALID_IMAGE");
    }
    // Scan the exact normalized image; flatten alpha consistently for both engines.
    png = await image.flatten({ background: "#ffffff" }).png().toBuffer();
  } catch {
    return incompleteLocalScan("INVALID_IMAGE");
  }

  try {
    const wasm = await readFile(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    await prepareZXingModule({
      overrides: { wasmBinary: new Uint8Array(wasm).buffer },
      fireImmediately: true,
    });
    const codes = await readBarcodes(png, {
      formats: ["All"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 32,
      returnErrors: true,
    });
    const complete = codes.length < 32 && codes.every((code) => code.isValid);
    const status = complete ? "COMPLETE" : "PARTIAL";
    result.qr = { status, detected: codes.some((code) => code.symbology === "QRCode") };
    result.barcode = { status, detected: codes.some((code) => code.symbology !== "QRCode") };
  } catch {
    /* Leave the failed engine unavailable without discarding other evidence. */
  }

  let completedLanguages = 0;
  let partial = false;
  const extracted: string[] = [];
  for (const code of ["eng", "kor"] as const) {
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      // Sequential local language passes bound memory and avoid runtime CDN downloads.
      worker = await createWorker(code, OEM.LSTM_ONLY, {
        langPath: dirname(languagePath(code)),
        cacheMethod: "none",
        logger: () => {},
        errorHandler: () => {},
        workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: "150",
      });
      const { data } = await worker.recognize(png, {}, { text: true });
      completedLanguages += 1;
      partial ||=
        data.text.length > 16_000 ||
        !Number.isFinite(data.confidence) ||
        (data.text.trim().length > 0 && data.confidence < 50);
      result.ocr.piiKinds = [...new Set([...result.ocr.piiKinds, ...detectOcrPiiKinds(data.text)])];
      if (receiveText) extracted.push(data.text.slice(0, 16_000));
    } catch {
      /* Missing language data and failed scans are not a clean result. */
    } finally {
      if (worker) await worker.terminate();
    }
  }
  result.ocr.status =
    completedLanguages === 0
      ? "UNAVAILABLE"
      : completedLanguages < 2 || partial
        ? "PARTIAL"
        : "COMPLETE";
  if (receiveText) {
    const minimized = minimizeEmbeddedText([...new Set(extracted)].join("\n"), result.ocr.status);
    // PII detected anywhere (including text beyond the extraction limit) withholds the entire OCR payload.
    receiveText(
      result.ocr.piiKinds.length ? { ...minimized, status: "WITHHELD_PII", text: "" } : minimized,
    );
  }
  if (
    result.qr.status === "COMPLETE" &&
    result.barcode.status === "COMPLETE" &&
    result.ocr.status === "COMPLETE"
  )
    delete result.failureCode;
  return result;
}
