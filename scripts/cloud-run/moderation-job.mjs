import { spawn } from "node:child_process";

import { moderationJobDefinition, runtimeEnvironment } from "./runtime.mjs";

let definition;
try {
  definition = moderationJobDefinition(runtimeEnvironment());
} catch (error) {
  // The runtime environment may contain credentials. Keep job failures safe to
  // surface in Cloud Run Logs without printing parsed configuration.
  console.error(
    "[cloud-run] Moderation job configuration failed.",
    error instanceof Error && error.message.startsWith("CLOUD_RUN_")
      ? error.message
      : "INVALID_CONFIGURATION",
  );
  process.exit(1);
}

const worker = spawn(process.execPath, definition.args, {
  cwd: definition.cwd,
  env: definition.env,
  stdio: "inherit",
});

worker.once("error", () => {
  console.error("[cloud-run] Moderation job failed to start.");
  process.exitCode = 1;
});
worker.once("exit", (code, signal) => {
  if (signal) {
    console.error("[cloud-run] Moderation job stopped before completing.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
