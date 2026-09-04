import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const secretFile = process.env.CLOUD_RUN_ENV_FILE;
if (!secretFile) {
  console.error("[cloud-run] CLOUD_RUN_ENV_FILE is required for migrations.");
  process.exit(1);
}

let stored;
try {
  stored = JSON.parse(readFileSync(secretFile, "utf8"));
} catch {
  console.error("[cloud-run] Migration runtime secret could not be read.");
  process.exit(1);
}

if (!stored || Array.isArray(stored) || typeof stored.DATABASE_URL !== "string") {
  console.error("[cloud-run] Migration runtime secret is invalid.");
  process.exit(1);
}

const apiDirectory = resolve(process.cwd(), "apps/api");
const child = spawn(process.execPath, ["dist/database/migrate.js"], {
  cwd: apiDirectory,
  env: { ...process.env, DATABASE_URL: stored.DATABASE_URL },
  stdio: "inherit",
});

child.once("error", () => {
  console.error("[cloud-run] Migration process failed to start.");
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error("[cloud-run] Migration process was interrupted.");
    process.exit(1);
  }
  process.exit(code ?? 1);
});
