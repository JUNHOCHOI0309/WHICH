import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  incompleteLocalScan,
  LOCAL_SCAN_MAX_BYTES,
  localScanResultSchema,
  type LocalScanFailure,
  type LocalScanResult,
} from "./local-scan-contract.js";
import type { LocalMediaSignalDetector } from "./upload-gate-policy.js";
import { EMBEDDED_TEXT_VERSION, embeddedTextSchema, type EmbeddedText } from "./embedded-text.js";

const environmentSchema = z.object({
  ISSUE_MEDIA_LOCAL_SCANNER_MODE: z.enum(["OFF", "LOCAL"]).default("OFF"),
  ISSUE_MEDIA_LOCAL_SCANNER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(15000),
});
export function localMediaScannerConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  return {
    enabled: parsed.ISSUE_MEDIA_LOCAL_SCANNER_MODE === "LOCAL",
    timeoutMs: parsed.ISSUE_MEDIA_LOCAL_SCANNER_TIMEOUT_MS,
  };
}

let activeScans = 0;
type ScannerOptions = {
  enabled: boolean;
  timeoutMs: number;
  workerUrl: URL;
  execArgv?: string[];
};
type ScannerOutput = LocalScanResult | { scan: LocalScanResult; embeddedText: EmbeddedText };
function createScanner(options: ScannerOptions, withText = false) {
  const incomplete = (failure: LocalScanFailure): ScannerOutput =>
    withText
      ? {
          scan: incompleteLocalScan(failure),
          embeddedText: { version: EMBEDDED_TEXT_VERSION, status: "UNAVAILABLE", text: "" },
        }
      : incompleteLocalScan(failure);
  return {
    async inspect(bytes: Buffer): Promise<ScannerOutput> {
      if (!options.enabled) return incomplete("DISABLED");
      if (!bytes.length || bytes.length > LOCAL_SCAN_MAX_BYTES) return incomplete("INPUT_LIMIT");
      if (activeScans >= 1) return incomplete("BUSY");
      activeScans += 1;
      try {
        return await new Promise<ScannerOutput>((resolve) => {
          // Do not forward provider keys, database/R2 credentials or NODE_OPTIONS into the child.
          const env: NodeJS.ProcessEnv = {};
          for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
            if (process.env[key]) env[key] = process.env[key];
          }
          const child = spawn(
            process.execPath,
            [
              "--max-old-space-size=192",
              ...(options.execArgv ?? []),
              fileURLToPath(options.workerUrl),
              ...(withText ? ["moderation-text"] : []),
            ],
            {
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
              env,
            },
          );
          let failure: LocalScanFailure | undefined;
          const chunks: Buffer[] = [];
          let length = 0;
          const stop = (reason: LocalScanFailure) => {
            failure ??= reason;
            child.kill("SIGKILL");
          };
          const timer = setTimeout(
            () => stop("TIMEOUT"),
            Math.min(30000, Math.max(1000, options.timeoutMs)),
          );
          child.on("error", () => {
            failure ??= "ENGINE_FAILURE";
          });
          child.stdin.on("error", () => stop("ENGINE_FAILURE"));
          child.stderr.resume(); // Never forward engine logs, which may contain extracted content.
          child.stdout.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > (withText ? 16384 : 8192)) stop("INVALID_OUTPUT");
            else chunks.push(chunk);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (failure || code !== 0) {
              resolve(incomplete(failure ?? "ENGINE_FAILURE"));
              return;
            }
            try {
              resolve(
                (withText
                  ? z
                      .object({ scan: localScanResultSchema, embeddedText: embeddedTextSchema })
                      .strict()
                  : localScanResultSchema
                ).parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
              );
            } catch {
              resolve(incomplete("INVALID_OUTPUT"));
            }
          });
          child.stdin.end(bytes);
        });
      } catch {
        return incomplete("ENGINE_FAILURE");
      } finally {
        activeScans -= 1;
      }
    },
  };
}

export function createLocalMediaSignalDetector(options: ScannerOptions): LocalMediaSignalDetector {
  const scanner = createScanner(options);
  return {
    async inspect(bytes) {
      return (await scanner.inspect(bytes)) as LocalScanResult;
    },
  };
}

// A separate opt-in transient path; the ordinary upload inspector still cannot return OCR text.
export function createLocalEmbeddedTextExtractor(options: ScannerOptions) {
  const scanner = createScanner(options, true);
  return async (bytes: Buffer): Promise<EmbeddedText> => {
    const output = await scanner.inspect(bytes);
    if (!("embeddedText" in output))
      return { version: EMBEDDED_TEXT_VERSION, status: "UNAVAILABLE", text: "" };
    const text = output.embeddedText;
    if (output.scan.ocr.piiKinds.length) return { ...text, status: "WITHHELD_PII", text: "" };
    if (output.scan.ocr.status !== "COMPLETE" && text.status === "COMPLETE")
      return { ...text, status: "PARTIAL" };
    return text;
  };
}
