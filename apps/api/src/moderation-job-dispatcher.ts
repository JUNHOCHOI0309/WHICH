import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { createDatabase } from "./database/client.js";
import { autoPublicationConfig } from "./modules/issue-media/auto-publication.js";
import { createSubmissionWakeups } from "./modules/moderation-dispatch/submission-wakeups.js";
import { createCloudRunJobStarter } from "./modules/moderation-dispatch/cloud-run-job.js";
import { createCloudTasksStarter } from "./modules/moderation-dispatch/cloud-tasks.js";

const dispatcherConfig = z
  .object({
    MODERATION_DISPATCH_TRANSPORT: z
      .enum(["CLOUD_RUN_JOB", "CLOUD_TASKS"])
      .default("CLOUD_RUN_JOB"),
    MODERATION_DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(16),
  })
  .parse(process.env);

async function main() {
  if (
    process.env.CLOUD_RUN_PREVIEW !== "false" ||
    process.env.MODERATION_JOB_DISPATCH_ENABLED !== "true"
  )
    return;
  const autoConfig = autoPublicationConfig();
  const memberIds =
    autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MODE === "MEMBER"
      ? null
      : autoConfig.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS;
  if ((memberIds && !memberIds.length) || !process.env.DATABASE_URL)
    throw new Error("DISPATCH_CONFIGURATION_REQUIRED");
  const transport = dispatcherConfig.MODERATION_DISPATCH_TRANSPORT;
  const start =
    transport === "CLOUD_TASKS"
      ? createCloudTasksStarter({
          queue: process.env.MODERATION_CLOUD_TASKS_QUEUE ?? "",
          workerUrl: process.env.MODERATION_TASK_WORKER_URL ?? "",
          serviceAccountEmail: process.env.MODERATION_TASK_SERVICE_ACCOUNT ?? "",
        })
      : createCloudRunJobStarter(process.env.MODERATION_CLOUD_RUN_JOB ?? "");
  const database = createDatabase(process.env.DATABASE_URL, { connectionTimeoutMillis: 10000 });
  const wakeups = createSubmissionWakeups(database.db, memberIds);
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => controller.abort());
  try {
    while (!controller.signal.aborted) {
      try {
        const result = await wakeups.dispatch(start, {
          limit: transport === "CLOUD_TASKS" ? dispatcherConfig.MODERATION_DISPATCH_BATCH_SIZE : 2,
          singleFlight: transport !== "CLOUD_TASKS",
        });
        if (result.status !== "IDLE")
          console.log(JSON.stringify({ kind: "MODERATION_JOB_DISPATCH", ...result }));
      } catch {
        console.error(JSON.stringify({ kind: "MODERATION_JOB_DISPATCH", status: "RETRY_LATER" }));
      }
      await wait(10000, undefined, { signal: controller.signal }).catch(() => {});
    }
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error("MODERATION_JOB_DISPATCH_CONFIGURATION_FAILED");
  process.exitCode = 1;
});
