type PointBatchSummary = {
  claimed: number;
  outcomes: readonly string[];
};

type PointWorkerLogger = {
  info(message: string): void;
  error(message: string): void;
};

export type PointWorkerRunnerOptions = {
  processBatch(): Promise<PointBatchSummary>;
  isStopping(): boolean;
  wait(milliseconds: number): Promise<void>;
  logger: PointWorkerLogger;
  idleDelayMs?: number;
  maximumRetryDelayMs?: number;
};

function boundedErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)
    ? error.name
    : "UNKNOWN_ERROR";
}

export function pointWorkerRetryDelay(consecutiveFailures: number, maximumRetryDelayMs = 30_000) {
  const exponent = Math.max(0, Math.min(consecutiveFailures - 1, 10));
  return Math.min(1_000 * 2 ** exponent, maximumRetryDelayMs);
}

export async function runPointWorker(options: PointWorkerRunnerOptions) {
  const idleDelayMs = options.idleDelayMs ?? 2_000;
  const maximumRetryDelayMs = options.maximumRetryDelayMs ?? 30_000;
  let consecutiveFailures = 0;

  while (!options.isStopping()) {
    try {
      const summary = await options.processBatch();
      consecutiveFailures = 0;
      if (summary.claimed > 0) options.logger.info(JSON.stringify(summary));
      else await options.wait(idleDelayMs);
    } catch (error) {
      consecutiveFailures += 1;
      const retryDelayMs = pointWorkerRetryDelay(consecutiveFailures, maximumRetryDelayMs);
      options.logger.error(
        JSON.stringify({
          event: "POINT_WORKER_BATCH_FAILED",
          errorCode: boundedErrorCode(error),
          consecutiveFailures,
          retryDelayMs,
        }),
      );
      await options.wait(retryDelayMs);
    }
  }
}
