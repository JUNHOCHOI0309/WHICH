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
export function createLocalMediaSignalDetector(options: {
  enabled: boolean;
  timeoutMs: number;
  workerUrl: URL;
  execArgv?: string[];
}): LocalMediaSignalDetector {
  return {
    async inspect(bytes) {
      if (!options.enabled) return incompleteLocalScan("DISABLED");
      if (!bytes.length || bytes.length > LOCAL_SCAN_MAX_BYTES)
        return incompleteLocalScan("INPUT_LIMIT");
      if (activeScans >= 1) return incompleteLocalScan("BUSY");
      activeScans += 1;
      try {
        return await new Promise<LocalScanResult>((resolve) => {
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
            if (length > 8192) stop("INVALID_OUTPUT");
            else chunks.push(chunk);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (failure || code !== 0) {
              resolve(incompleteLocalScan(failure ?? "ENGINE_FAILURE"));
              return;
            }
            try {
              resolve(
                localScanResultSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
              );
            } catch {
              resolve(incompleteLocalScan("INVALID_OUTPUT"));
            }
          });
          child.stdin.end(bytes);
        });
      } catch {
        return incompleteLocalScan("ENGINE_FAILURE");
      } finally {
        activeScans -= 1;
      }
    },
  };
}
