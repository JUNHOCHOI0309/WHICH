import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "../../database/client.js";
import {
  createOctoparsePollClient,
  PollSyncError,
  type OctoparsePollClient,
} from "./octoparse-polls.js";
import { pollSyncDay, pollSyncSettings } from "./poll-sync-config.js";

type Run = {
  day: string;
  task_id: string;
  status: string;
  phase: string;
  attempts: number;
  next_retry_at: Date | null;
};

// A dedicated session lock spans the provider calls, but no DB transaction is held while waiting.
export async function runDailyPollSync(
  database: Database["db"],
  options: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    provider?: OctoparsePollClient;
    signal?: AbortSignal;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const settings = pollSyncSettings(options.env);
  if (!settings.configured || !settings.config) return { status: "NOT_CONFIGURED" };
  if (!settings.enabled) return { status: "DISABLED" };
  const now = options.now ?? new Date();
  const today = pollSyncDay(now);
  if (!today) return { status: "NOT_DUE" };
  const config = settings.config;
  const provider = options.provider ?? createOctoparsePollClient(config);
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(20 * 60_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const client = await database.$client.connect();
  let lost = false,
    acquired = false,
    runDay: string | undefined;
  const onError = () => {
    lost = true;
    controller.abort();
  };
  client.on("error", onError);
  try {
    acquired =
      (
        await client.query<{ acquired: boolean }>(
          "select pg_try_advisory_lock(hashtextextended('which:daily-poll-sync:v1', 0)) as acquired",
        )
      ).rows[0]?.acquired ?? false;
    if (!acquired) return { status: "BUSY" };
    const actor = await client.query(
      "select 1 from operator_access_grants g join members m on m.member_id=g.member_id where g.member_id=$1 and g.revoked_at is null and m.status='ACTIVE'",
      [config.memberId],
    );
    if (!actor.rowCount) throw new PollSyncError("IMPORT_OPERATOR_REQUIRED");
    // Resume a previous incomplete export before starting a new extraction. Never silently skip a failed day.
    const previous = (
      await client.query<Run>(
        "select * from operator_poll_sync_runs where status <> 'SUCCEEDED' order by day limit 1",
      )
    ).rows[0];
    const existing =
      previous ??
      (await client.query<Run>("select * from operator_poll_sync_runs where day=$1", [today]))
        .rows[0];
    if (existing?.status === "SUCCEEDED") return { status: "ALREADY_COMPLETED" };
    if (existing && existing.task_id !== config.taskId)
      return { status: "TASK_CHANGED_REVIEW_REQUIRED" };
    if (existing?.phase === "REQUESTING") return { status: "START_UNCERTAIN_REVIEW_REQUIRED" };
    if (existing && existing.attempts >= 3) return { status: "RETRY_LIMIT_REVIEW_REQUIRED" };
    if (existing?.next_retry_at && existing.next_retry_at > now) return { status: "RETRY_NOT_DUE" };
    runDay = existing?.day ?? today;
    if (!existing) {
      await client.query(
        "insert into operator_poll_sync_runs(day,task_id,status,phase,started_at) values($1,$2,'RUNNING','REQUESTING',$3)",
        [runDay, config.taskId, now],
      );
      // Persist intent BEFORE a potentially billable, non-idempotent network request.
      await provider.start(signal);
      signal.throwIfAborted();
      await client.query("update operator_poll_sync_runs set phase='ACCEPTED' where day=$1", [
        runDay,
      ]);
    } else {
      await client.query(
        "update operator_poll_sync_runs set status='RUNNING',attempts=attempts+1,error_code=null,finished_at=null,next_retry_at=null where day=$1",
        [runDay],
      );
    }
    let result: Awaited<ReturnType<OctoparsePollClient["read"]>>;
    do {
      signal.throwIfAborted();
      result = await provider.read(signal);
      if (result.status === "WAITING") {
        if (!Number.isFinite(result.waitMs) || result.waitMs > 20 * 60_000)
          throw new PollSyncError("PROVIDER_WAIT_EXCEEDS_JOB_WINDOW");
        await (options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort })))(
          result.waitMs,
          signal,
        );
      }
    } while (result.status === "WAITING");
    signal.throwIfAborted();
    if (!result.rows.length) throw new PollSyncError("SOURCE_NO_DATA_REVIEW_REQUIRED");
    let imported = 0;
    await client.query("begin");
    try {
      // Recheck actor at the write boundary and atomically commit the import and success marker.
      const active = await client.query(
        "select 1 from operator_access_grants g join members m on m.member_id=g.member_id where g.member_id=$1 and g.revoked_at is null and m.status='ACTIVE' for share of g,m",
        [config.memberId],
      );
      if (!active.rowCount) throw new PollSyncError("IMPORT_OPERATOR_REQUIRED");
      for (const row of result.rows) {
        signal.throwIfAborted();
        const key = createHash("sha256").update(`youtube:${row.source.postId}`).digest("hex");
        const source = { ...row.source, rawRecord: row.raw, collectedAt: new Date().toISOString() };
        const inserted = await client.query(
          "insert into operator_poll_candidates(source_key,source,imported_by_member_id) values($1,$2,$3) on conflict(source_key) do nothing returning id",
          [key, JSON.stringify(source), config.memberId],
        );
        imported += inserted.rowCount ?? 0;
      }
      const duplicates = result.rows.length - imported;
      await client.query(
        "update operator_poll_sync_runs set status='SUCCEEDED',phase='IMPORTED',imported=$2,duplicates=$3,finished_at=now(),error_code=null,next_retry_at=null where day=$1",
        [runDay, imported, duplicates],
      );
      await client.query("commit");
      return { status: "SUCCEEDED", day: runDay, imported, duplicates };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } catch (error) {
    const code =
      error instanceof PollSyncError
        ? error.code
        : signal.aborted
          ? "RUN_INTERRUPTED"
          : "SYNC_FAILED";
    if (runDay && !lost)
      await client
        .query(
          "update operator_poll_sync_runs set status='FAILED',error_code=$2,finished_at=now(),next_retry_at=now()+interval '15 minutes' where day=$1 and status <> 'SUCCEEDED'",
          [runDay, code],
        )
        .catch(() => undefined);
    return { status: "FAILED", code };
  } finally {
    if (acquired && !lost)
      await client
        .query("select pg_advisory_unlock(hashtextextended('which:daily-poll-sync:v1', 0))")
        .catch(() => {
          lost = true;
        });
    client.removeListener("error", onError);
    client.release(lost);
  }
}
