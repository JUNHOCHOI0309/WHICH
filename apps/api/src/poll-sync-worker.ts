import { resolve } from "node:path";
import { config as loadEnvironment } from "dotenv";
import { createDatabase } from "./database/client.js";
import { runDailyPollSync } from "./modules/operations/poll-sync.js";
import { pollSyncSettings } from "./modules/operations/poll-sync-config.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});
const settings = pollSyncSettings();
if (!settings.enabled) {
  console.info(
    JSON.stringify({
      event: "POLL_SYNC",
      status: settings.configured ? "DISABLED" : "NOT_CONFIGURED",
    }),
  );
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error(JSON.stringify({ event: "POLL_SYNC", status: "DATABASE_NOT_CONFIGURED" }));
  process.exitCode = 1;
} else {
  const database = createDatabase(process.env.DATABASE_URL, { maxConnections: 2 });
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(20 * 60_000)]);
  for (const name of ["SIGTERM", "SIGINT"] as const) process.once(name, () => stop.abort());
  try {
    const result = await runDailyPollSync(database.db, { signal });
    console.info(JSON.stringify({ event: "POLL_SYNC", ...result }));
    if (!["SUCCEEDED", "ALREADY_COMPLETED", "BUSY", "NOT_DUE"].includes(result.status))
      process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ event: "POLL_SYNC", status: "FAILED" }));
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
