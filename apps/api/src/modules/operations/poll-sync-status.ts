import { desc, eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { operatorPollSyncRuns } from "../../database/schema/index.js";
import { POLL_SYNC_SCHEDULE, pollSyncSettings } from "./poll-sync-config.js";

export async function readPollSyncStatus(
  database: Database["db"],
  env: NodeJS.ProcessEnv = process.env,
) {
  const settings = pollSyncSettings(env);
  const columns = {
    day: operatorPollSyncRuns.day,
    status: operatorPollSyncRuns.status,
    phase: operatorPollSyncRuns.phase,
    attempts: operatorPollSyncRuns.attempts,
    imported: operatorPollSyncRuns.imported,
    duplicates: operatorPollSyncRuns.duplicates,
    errorCode: operatorPollSyncRuns.errorCode,
    startedAt: operatorPollSyncRuns.startedAt,
    finishedAt: operatorPollSyncRuns.finishedAt,
    channelReports: operatorPollSyncRuns.channelReports,
  };
  const [latest] = await database
    .select(columns)
    .from(operatorPollSyncRuns)
    .orderBy(desc(operatorPollSyncRuns.day))
    .limit(1);
  const [success] = await database
    .select({ at: operatorPollSyncRuns.finishedAt })
    .from(operatorPollSyncRuns)
    .where(eq(operatorPollSyncRuns.status, "SUCCEEDED"))
    .orderBy(desc(operatorPollSyncRuns.day))
    .limit(1);
  // Job-only credentials need not be mounted in the web API. This public flag is set only
  // after an operator verifies and enables the external scheduler, never by a successful import.
  const enabled = env.POLL_SYNC_SCHEDULE_ACTIVE === "true";
  return {
    ...POLL_SYNC_SCHEDULE,
    provider: "YouTube.js",
    maxPages: settings.config?.maxPages ?? 5,
    configured: settings.configured || !!latest,
    enabled,
    latest: latest ?? null,
    lastSuccessfulImportAt: success?.at ?? null,
  };
}
