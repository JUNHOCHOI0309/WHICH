import { setTimeout as delay } from "node:timers/promises";

// Direct VPC/NAT can take over a minute to become ready on a cold Job.
// Retry only a read-only readiness check, never the import operation itself.
export async function waitForPollDatabase(
  ping: () => Promise<void>,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = (ms, abort) =>
    delay(ms, undefined, { signal: abort }),
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    signal.throwIfAborted();
    try {
      await ping();
      signal.throwIfAborted();
      return;
    } catch {
      signal.throwIfAborted();
      if (attempt === 3) throw new Error("POLL_DATABASE_NOT_READY");
      await wait(5_000, signal);
    }
  }
}
