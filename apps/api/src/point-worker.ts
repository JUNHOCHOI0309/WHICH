import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { createPointPolicyConsumer } from "./modules/points/policy.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const command = process.argv[2] ?? "run";
const config = getConfig(process.env);
const database = createDatabase(config.databaseUrl);
const consumer = createPointPolicyConsumer(database.db, {
  enabled: config.featureFlags.points,
});

function wait(milliseconds: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

try {
  if (command === "once") {
    console.log(JSON.stringify(await consumer.processBatch(), null, 2));
  } else if (command === "run") {
    let stopping = false;
    process.once("SIGINT", () => (stopping = true));
    process.once("SIGTERM", () => (stopping = true));
    while (!stopping) {
      const summary = await consumer.processBatch();
      if (summary.claimed > 0) console.log(JSON.stringify(summary));
      else await wait(2_000);
    }
  } else {
    throw new Error(`Unknown Point Worker command: ${command}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await database.close();
}
