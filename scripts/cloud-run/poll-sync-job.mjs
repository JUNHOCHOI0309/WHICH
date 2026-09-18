import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeEnvironment } from "./runtime.mjs";

let environment;
try {
  environment = runtimeEnvironment();
  if (environment.CLOUD_RUN_PREVIEW !== "false") throw new Error();
  const stored = JSON.parse(readFileSync(environment.POLL_SYNC_ENV_FILE, "utf8"));
  const keys = [
    "OCTOPARSE_TASK_ID",
    "OCTOPARSE_API_KEY",
    "OCTOPARSE_IMPORT_MEMBER_ID",
    "OCTOPARSE_EXPORT_HOSTS",
    "OCTOPARSE_MAPPING_VERIFIED",
  ];
  if (!stored || keys.some((key) => typeof stored[key] !== "string" || !stored[key]))
    throw new Error();
  for (const key of keys) environment[key] = stored[key];
  if (environment.POLL_SYNC_ENABLED !== "true") throw new Error();
} catch {
  console.error("[poll-sync] NOT_CONFIGURED_OR_DISABLED");
  process.exit(1);
}
const child = spawn(process.execPath, ["dist/poll-sync-worker.js"], {
  cwd: resolve(process.cwd(), "apps/api"),
  env: environment,
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
child.once("error", () => {
  console.error("[poll-sync] START_FAILED");
  process.exit(1);
});
child.once("exit", (code) => process.exit(code ?? 1));
