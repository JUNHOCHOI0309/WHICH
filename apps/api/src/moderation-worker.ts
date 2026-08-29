import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import { createDatabase } from "./database/client.js";
import {
  createR2IssueMediaStorage,
  issueMediaStorageConfig,
} from "./modules/issue-media/storage.js";
import { createModerationDispatcherService } from "./modules/moderation-dispatch/service.js";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MODERATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  MODERATION_WORKER_LEASE_MS: z.coerce.number().int().min(5_000).default(60_000),
  MODERATION_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  MODERATION_WORKER_RETRY_BASE_MS: z.coerce.number().int().min(100).default(5_000),
  MODERATION_WORKER_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(300_000),
  MODERATION_WORKER_POLL_MS: z.coerce.number().int().min(250).default(2_000),
});

const config = environmentSchema.parse(process.env);
if (config.MODERATION_WORKER_RETRY_MAX_MS < config.MODERATION_WORKER_RETRY_BASE_MS) {
  throw new Error("MODERATION_WORKER_RETRY_MAX_MS must be at least the retry base.");
}

const database = createDatabase(config.DATABASE_URL);
const worker = createModerationDispatcherService(database.db, null, {
  batchSize: config.MODERATION_WORKER_BATCH_SIZE,
  leaseMilliseconds: config.MODERATION_WORKER_LEASE_MS,
  maxAttempts: config.MODERATION_WORKER_MAX_ATTEMPTS,
  retryBaseMilliseconds: config.MODERATION_WORKER_RETRY_BASE_MS,
  retryMaxMilliseconds: config.MODERATION_WORKER_RETRY_MAX_MS,
});

async function once() {
  const dispatched = await worker.dispatchBatch();
  const processed = await worker.processBatch();
  return { dispatched, processed };
}

async function main() {
  const command = process.argv[2] ?? "once";
  if (command === "once") {
    console.log(JSON.stringify(await once(), null, 2));
    return;
  }
  if (command === "run") {
    while (true) {
      console.log(JSON.stringify(await once()));
      await wait(config.MODERATION_WORKER_POLL_MS);
    }
  }
  if (command === "dead-letters") {
    console.log(
      JSON.stringify(await worker.listDeadLetters(Number(process.argv[3]) || 50), null, 2),
    );
    return;
  }
  if (command === "requeue") {
    const runId = process.argv[3];
    if (!runId) throw new Error("Usage: moderation-worker requeue <run-id>");
    console.log(JSON.stringify(await worker.requeueDeadLetter(runId), null, 2));
    return;
  }
  if (command === "reconcile-media") {
    const storageConfig = issueMediaStorageConfig();
    if (!storageConfig) throw new Error("Issue media R2 configuration is incomplete.");
    const storage = createR2IssueMediaStorage(storageConfig);
    console.log(JSON.stringify(await worker.reconcileMedia(storage), null, 2));
    return;
  }
  throw new Error(`Unknown Moderation Worker command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => database.close());
