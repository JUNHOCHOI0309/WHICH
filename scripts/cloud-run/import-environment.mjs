// Explicit operator command. Credentials only travel through process memory/stdin,
// never command arguments, logs, a git file, or the container build context.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

const [source, project, databaseHost, secret = "which-runtime-env"] = process.argv.slice(2);
if (
  !source ||
  !/^[a-z][a-z0-9-]{4,62}$/.test(project ?? "") ||
  !/^[a-z0-9.-]+\.render\.com$/.test(databaseHost ?? "") ||
  !/^[a-zA-Z0-9_-]+$/.test(secret)
) {
  console.error(
    "Usage: node import-environment.mjs <Render-export.env> <project> <external-db-host> [secret]",
  );
  process.exit(1);
}
try {
  const environment = parseEnv(readFileSync(source, "utf8"));
  const database = new URL(environment.DATABASE_URL);
  database.hostname = databaseHost;
  database.searchParams.set("sslmode", "verify-full");
  environment.DATABASE_URL = database.toString();
  // Cloud Run supplies these itself. Avoid reviving an old deployment identity.
  for (const key of [
    "PORT",
    "API_PORT",
    "API_HOST",
    "API_BASE_URL",
    "RELEASE_ID",
    "RENDER_GIT_COMMIT",
    "HOSTNAME",
    "NODE_OPTIONS",
  ])
    delete environment[key];
  const result = spawnSync(
    process.platform === "win32" ? "gcloud.cmd" : "gcloud",
    ["secrets", "versions", "add", secret, `--project=${project}`, "--data-file=-", "--quiet"],
    { input: JSON.stringify(environment), encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.status !== 0) throw new Error("SECRET_UPLOAD_FAILED");
  console.log(
    JSON.stringify({
      uploaded: true,
      project,
      secret,
      keyCount: Object.keys(environment).length,
      databaseTls: "verify-full",
    }),
  );
} catch {
  console.error("Runtime environment import failed; no credential values were logged.");
  process.exit(1);
}
