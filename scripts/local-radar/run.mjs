import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalRadarDatabase,
  assertNoEnvironmentFiles,
  localRadarEnvironment,
} from "./profile.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const api = resolve(root, "apps/api");
const web = resolve(root, "apps/web");
const env = localRadarEnvironment();
for (const directory of [root, api, web]) assertNoEnvironmentFiles(readdirSync(directory));
assertLocalRadarDatabase(env.DATABASE_URL);
const children = new Set();
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function run(command, args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
    children.add(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (code === 0 || (stopping && signal)) resolveRun();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
const apiScript = (file) => run(process.execPath, ["--import", "tsx", file], api);

async function assertPortFree(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Local port ${port} is occupied. Stop its owner explicitly; this script will not kill it.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolvePort));
  });
}

try {
  switch (process.argv[2]) {
    case "setup":
      await run("docker", ["compose", "-f", "infra/compose.radar.yaml", "up", "-d", "--wait"]);
      await apiScript("src/database/migrate.ts");
      await apiScript("src/database/seed.ts");
      console.log("Radar local DB ready. Synthetic demo data only. Run pnpm radar:dev.");
      break;
    case "dev":
      await assertPortFree(3000);
      await assertPortFree(4000);
      console.log(
        "Radar LOCAL ONLY: http://localhost:3000 / API 127.0.0.1:4000 / DB 127.0.0.1:54339",
      );
      await Promise.all([
        // No watcher wrapper: stop/restart after API edits to avoid orphan processes.
        apiScript("src/server.ts"),
        run(
          process.execPath,
          [
            resolve(web, "node_modules/next/dist/bin/next"),
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            "3000",
          ],
          web,
        ),
      ]);
      break;
    case "stop-db":
      await run("docker", ["compose", "-f", "infra/compose.radar.yaml", "stop"]);
      break;
    case "test-db":
      await run(
        process.execPath,
        [
          resolve(api, "node_modules/vitest/vitest.mjs"),
          "run",
          "test/radar-storage.integration.test.ts",
          "test/radar-ingestion.integration.test.ts",
          "test/issue-read.integration.test.ts",
          "test/voting.integration.test.ts",
          "--maxWorkers=1",
        ],
        api,
      );
      break;
    case "migrate":
      await apiScript("src/database/migrate.ts");
      break;
    default:
      throw new Error("Usage: node scripts/local-radar/run.mjs setup|dev|stop-db|test-db|migrate");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  stop();
}
