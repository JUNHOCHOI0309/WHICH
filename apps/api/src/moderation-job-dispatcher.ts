import { setTimeout as wait } from "node:timers/promises";
import { createDatabase } from "./database/client.js";
import { autoPublicationConfig } from "./modules/issue-media/auto-publication.js";
import { createSubmissionWakeups } from "./modules/moderation-dispatch/submission-wakeups.js";
import { createCloudRunJobStarter } from "./modules/moderation-dispatch/cloud-run-job.js";

async function main() {
  if (
    process.env.CLOUD_RUN_PREVIEW !== "false" ||
    process.env.MODERATION_JOB_DISPATCH_ENABLED !== "true"
  )
    return;
  const cohort = autoPublicationConfig().ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS;
  if (!cohort.length || !process.env.DATABASE_URL)
    throw new Error("DISPATCH_CONFIGURATION_REQUIRED");
  const start = createCloudRunJobStarter(process.env.MODERATION_CLOUD_RUN_JOB ?? "");
  const database = createDatabase(process.env.DATABASE_URL, { connectionTimeoutMillis: 10000 });
  const wakeups = createSubmissionWakeups(database.db, cohort);
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => controller.abort());
  try {
    while (!controller.signal.aborted) {
      try {
        const result = await wakeups.dispatch(start);
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
