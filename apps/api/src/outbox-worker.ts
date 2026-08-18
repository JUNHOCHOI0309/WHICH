import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { createDatabase } from "./database/client.js";
import { getOutboxWorkerConfig } from "./modules/outbox/config.js";
import { createHttpOutboxTransport } from "./modules/outbox/http-transport.js";
import { createOutboxPublisherService } from "./modules/outbox/service.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const command = process.argv[2] ?? "run";
const needsDelivery = command === "run" || command === "once";
const config = getOutboxWorkerConfig(process.env, needsDelivery);
const database = createDatabase(config.databaseUrl);
const transport = config.delivery ? createHttpOutboxTransport(config.delivery) : null;
const publisher = createOutboxPublisherService(database.db, transport, config.publisher);

function wait(milliseconds: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function run() {
  if (command === "once") {
    console.log(JSON.stringify(await publisher.processBatch(), null, 2));
    return;
  }
  if (command === "dead-letters") {
    const limit = process.argv[3] ? Number(process.argv[3]) : undefined;
    console.log(JSON.stringify(await publisher.listDeadLetters(limit), null, 2));
    return;
  }
  if (command === "requeue") {
    const eventId = process.argv[3];
    if (!eventId) throw new Error("Usage: outbox-worker requeue <event-id>");
    const event = await publisher.requeueDeadLetter(eventId);
    if (!event) throw new Error("Dead Letter was not found or was already requeued.");
    console.log(JSON.stringify(event, null, 2));
    return;
  }
  if (command !== "run") {
    throw new Error(`Unknown Outbox Worker command: ${command}`);
  }

  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });

  while (!stopping) {
    const summary = await publisher.processBatch();
    if (summary.claimed > 0) console.log(JSON.stringify(summary));
    if (summary.claimed === 0) await wait(config.pollIntervalMilliseconds);
  }
}

try {
  await run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await database.close();
}
