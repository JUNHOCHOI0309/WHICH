import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalMediaSignalDetector,
  localMediaScannerConfig,
  createLocalEmbeddedTextExtractor,
} from "../src/modules/issue-media/local-scan-detector.js";
import {
  incompleteLocalScan,
  LOCAL_SCAN_MAX_BYTES,
} from "../src/modules/issue-media/local-scan-contract.js";

const scriptUrl = new URL("../src/local-media-scanner.ts", import.meta.url);
const detector = (script: string, timeoutMs = 1000) =>
  createLocalMediaSignalDetector({
    enabled: true,
    timeoutMs,
    workerUrl: scriptUrl,
    execArgv: ["--eval", script],
  });
afterEach(() => vi.unstubAllEnvs());

describe("local scanner isolation and limits", () => {
  it("discards malformed or failed text IPC without exposing child output", async () => {
    for (const script of [
      "process.stdin.resume(); process.stdout.write('private text')",
      "process.stdin.resume(); process.exit(2)",
    ]) {
      const extract = createLocalEmbeddedTextExtractor({
        enabled: true,
        timeoutMs: 1000,
        workerUrl: scriptUrl,
        execArgv: ["--eval", script],
      });
      expect(await extract(Buffer.from("x"))).toMatchObject({ status: "UNAVAILABLE", text: "" });
    }
  });
  it("defaults OFF and rejects invalid runtime limits", async () => {
    expect(localMediaScannerConfig({})).toEqual({ enabled: false, timeoutMs: 15000 });
    expect(() =>
      localMediaScannerConfig({ ISSUE_MEDIA_LOCAL_SCANNER_TIMEOUT_MS: "NaN" }),
    ).toThrow();
    expect(() => localMediaScannerConfig({ ISSUE_MEDIA_LOCAL_SCANNER_MODE: "typo" })).toThrow();
    expect(
      await createLocalMediaSignalDetector({
        enabled: false,
        timeoutMs: 1000,
        workerUrl: scriptUrl,
      }).inspect(Buffer.from("x")),
    ).toMatchObject({ failureCode: "DISABLED" });
  });
  it("fails closed without spawning for empty or oversized input", async () => {
    const scan = detector("throw Error('must not execute')");
    expect(await scan.inspect(Buffer.alloc(0))).toMatchObject({ failureCode: "INPUT_LIMIT" });
    expect(await scan.inspect(Buffer.alloc(LOCAL_SCAN_MAX_BYTES + 1))).toMatchObject({
      failureCode: "INPUT_LIMIT",
    });
  });
  it("kills a timed-out child, bounds concurrency across instances, and frees its slot", async () => {
    const pending = detector("process.stdin.resume(); setInterval(() => {}, 1000)").inspect(
      Buffer.from("x"),
    );
    expect(await detector("").inspect(Buffer.from("x"))).toMatchObject({ failureCode: "BUSY" });
    expect(await pending).toMatchObject({ failureCode: "TIMEOUT" });
    expect(await detector("process.stdin.resume();").inspect(Buffer.from("x"))).toMatchObject({
      failureCode: "INVALID_OUTPUT",
    });
  }, 5000);
  it.each([
    "not JSON",
    JSON.stringify({ ...incompleteLocalScan("ENGINE_FAILURE"), rawText: "secret" }),
    "x".repeat(9000),
  ])("discards invalid child output %#", async (output) => {
    expect(
      await detector(
        `process.stdin.resume(); process.stdout.write(${JSON.stringify(output)});`,
      ).inspect(Buffer.from("x")),
    ).toMatchObject({ failureCode: "INVALID_OUTPUT" });
  });
  it("does not inherit provider, DB or Node preload credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    vi.stubEnv("DATABASE_URL", "synthetic-test-database");
    vi.stubEnv("NODE_OPTIONS", "--require=does-not-exist");
    const safe = incompleteLocalScan("DISABLED");
    const script = `process.stdin.resume(); if (process.env.OPENAI_API_KEY || process.env.DATABASE_URL || process.env.NODE_OPTIONS) process.exit(4); process.stdout.write(${JSON.stringify(JSON.stringify(safe))});`;
    expect(await detector(script).inspect(Buffer.from("x"))).toEqual(safe);
  });
  it("discards engine crashes and stderr content", async () => {
    expect(
      await detector(
        "process.stdin.resume(); process.stderr.write('private decoded text'); process.exit(2)",
      ).inspect(Buffer.from("x")),
    ).toMatchObject({ failureCode: "ENGINE_FAILURE" });
  });
});
