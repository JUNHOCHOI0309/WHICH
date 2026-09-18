import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { runtimeEnvironment } from "./runtime.mjs";

let environment;
try {
  environment = runtimeEnvironment();
  if (environment.CLOUD_RUN_PREVIEW !== "false") throw new Error();
  if (!process.argv.includes("--probe") && environment.POLL_SYNC_ENABLED !== "true")
    throw new Error();
} catch {
  console.error("[poll-sync] NOT_CONFIGURED_OR_DISABLED");
  process.exit(1);
}
const child = spawn(
  process.execPath,
  ["dist/poll-sync-worker.js", ...(process.argv.includes("--probe") ? ["--probe"] : [])],
  {
    cwd: resolve(process.cwd(), "apps/api"),
    env: environment,
    stdio: "inherit",
  },
);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
child.once("error", () => {
  console.error("[poll-sync] START_FAILED");
  process.exit(1);
});
child.once("exit", (code) => process.exit(code ?? 1));
