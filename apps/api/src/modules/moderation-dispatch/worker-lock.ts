import type { Database } from "../../database/client.js";

// Serialize full runtime batches across overlapping Render deploys and CLI `once`.
// The free-provider audit cap is checked inside this lock; the paid ledger is atomic itself.
export async function withModerationWorkerLock<T>(
  database: Database["db"],
  work: () => Promise<T>,
) {
  const client = await database.$client.connect();
  let lost = false;
  const onError = () => {
    lost = true;
  };
  client.on("error", onError);
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtextextended('which:moderation-runtime:v1', 0)) as acquired",
    );
    if (!rows[0]?.acquired) return { status: "WORKER_BUSY" } as const;
    const value = await work();
    if (lost) throw new Error("MODERATION_WORKER_LOCK_LOST");
    return value;
  } finally {
    if (!lost)
      await client
        .query("select pg_advisory_unlock(hashtextextended('which:moderation-runtime:v1', 0))")
        .catch(() => {
          lost = true;
        });
    client.removeListener("error", onError);
    client.release(lost);
  }
}
