import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "../../database/client.js";
import {
  createYouTubePollCollector,
  POLL_SOURCE_ID,
  PollSyncError,
  type PollCollector,
  type ChannelReport,
} from "./youtube-polls.js";
import { POLL_CHANNEL_REGISTER } from "./poll-channels.js";
import { pollSyncDay, pollSyncSettings } from "./poll-sync-config.js";

type Run = {
  day: string;
  task_id: string;
  status: string;
  attempts: number;
  imported: number;
  duplicates: number;
  next_retry_at: Date | null;
  channel_reports: ChannelReport[];
};
const actorSql =
  "select 1 from operator_access_grants g join members m on m.member_id=g.member_id where g.member_id=$1 and g.revoked_at is null and m.status='ACTIVE'";

export async function runDailyPollSync(
  database: Database["db"],
  options: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    provider?: PollCollector;
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
  const provider = options.provider ?? createYouTubePollCollector(config.maxPages);
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(20 * 60_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const client = await database.$client.connect();
  let lost = false,
    acquired = false,
    started = false;
  let imported = 0,
    duplicates = 0;
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
    if (!(await client.query(actorSql, [config.memberId])).rowCount)
      throw new PollSyncError("IMPORT_OPERATOR_REQUIRED");
    const existing = (
      await client.query<Run>("select * from operator_poll_sync_runs where day=$1", [today])
    ).rows[0];
    if (existing?.task_id && existing.task_id !== POLL_SOURCE_ID)
      return { status: "SOURCE_CHANGED_REVIEW_REQUIRED" };
    if (existing?.status === "SUCCEEDED") return { status: "ALREADY_COMPLETED" };
    if (existing && existing.attempts >= 3) return { status: "RETRY_LIMIT_REACHED" };
    if (existing?.next_retry_at && existing.next_retry_at > now) return { status: "RETRY_NOT_DUE" };
    let reports: ChannelReport[] = existing?.channel_reports ?? [];
    imported = existing?.imported ?? 0;
    duplicates = existing?.duplicates ?? 0;
    if (!existing) {
      await client.query(
        "insert into operator_poll_sync_runs(day,task_id,status,phase,started_at) values($1,$2,'RUNNING','ACCEPTED',$3)",
        [today, POLL_SOURCE_ID, now],
      );
    } else {
      // Source reads are safe to repeat after a crash; committed channels are skipped.
      await client.query(
        "update operator_poll_sync_runs set status='RUNNING',attempts=attempts+1,error_code=null,finished_at=null,next_retry_at=null where day=$1",
        [today],
      );
    }
    started = true;
    for (const channel of POLL_CHANNEL_REGISTER) {
      signal.throwIfAborted();
      if (
        reports.some(
          (r) => r.channel === channel.name && (r.status === "OK" || r.status === "HELD"),
        )
      )
        continue;
      const result = channel.initialBatchEligible
        ? await provider.collect(channel, signal)
        : {
            report: {
              channel: channel.name,
              status: "HELD" as const,
              pages: 0,
              posts: 0,
              polls: 0,
              skipped: 0,
              hasMore: false,
            },
            rows: [],
          };
      signal.throwIfAborted();
      let added = 0,
        repeated = 0;
      await client.query("begin");
      try {
        if (!(await client.query(actorSql + " for share of g,m", [config.memberId])).rowCount)
          throw new PollSyncError("IMPORT_OPERATOR_REQUIRED");
        if (result.report.status === "OK") {
          for (const row of result.rows) {
            signal.throwIfAborted();
            const key = createHash("sha256").update(`youtube:${row.source.postId}`).digest("hex");
            const source = {
              ...row.source,
              rawRecord: row.raw,
              collectedAt: new Date().toISOString(),
            };
            const inserted = await client.query(
              "insert into operator_poll_candidates(source_key,source,imported_by_member_id) values($1,$2,$3) on conflict(source_key) do nothing returning id",
              [key, JSON.stringify(source), config.memberId],
            );
            added += inserted.rowCount ?? 0;
          }
          repeated = result.rows.length - added;
        }
        const nextReports = [
          ...reports.filter((r) => r.channel !== channel.name),
          { ...result.report, imported: added, duplicates: repeated },
        ];
        await client.query(
          "update operator_poll_sync_runs set imported=$2,duplicates=$3,channel_reports=$4 where day=$1",
          [today, imported + added, duplicates + repeated, JSON.stringify(nextReports)],
        );
        await client.query("commit");
        reports = nextReports;
        imported += added;
        duplicates += repeated;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
      if (channel.initialBatchEligible)
        await (options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort })))(
          1000,
          signal,
        );
    }
    const failed = reports.filter((r) => r.status === "FAILED").length;
    const status = failed ? "FAILED" : "SUCCEEDED";
    await client.query(
      "update operator_poll_sync_runs set status=$2,phase='IMPORTED',finished_at=now(),error_code=$3,next_retry_at=$4 where day=$1",
      [
        today,
        status,
        failed ? "CHANNELS_FAILED" : null,
        failed ? new Date(now.getTime() + 15 * 60_000) : null,
      ],
    );
    return { status, day: today, imported, duplicates, failedChannels: failed, channels: reports };
  } catch (error) {
    const code =
      error instanceof PollSyncError
        ? error.code
        : signal.aborted
          ? "RUN_INTERRUPTED"
          : "SYNC_FAILED";
    if (started && !lost)
      await client
        .query(
          "update operator_poll_sync_runs set status='FAILED',error_code=$2,finished_at=now(),next_retry_at=$3 where day=$1 and status <> 'SUCCEEDED'",
          [today, code, new Date(now.getTime() + 15 * 60_000)],
        )
        .catch(() => undefined);
    return { status: "FAILED", code, imported, duplicates };
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
