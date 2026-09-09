import { describe, expect, it, vi } from "vitest";

import { pointWorkerRetryDelay, runPointWorker } from "../src/modules/points/worker-runner.js";

describe("Point Worker runner", () => {
  it("backs off and continues after a batch failure without leaking the error message", async () => {
    let calls = 0;
    let stopping = false;
    const delays: number[] = [];
    const info = vi.fn();
    const error = vi.fn();

    await runPointWorker({
      processBatch() {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(
            Object.assign(new Error("postgresql://secret.example/which"), {
              code: "POINT_DATABASE_UNAVAILABLE",
            }),
          );
        }
        return Promise.resolve({ claimed: 0, outcomes: [] });
      },
      isStopping: () => stopping,
      wait(milliseconds) {
        delays.push(milliseconds);
        if (calls >= 2) stopping = true;
        return Promise.resolve();
      },
      logger: { info, error },
    });

    expect(calls).toBe(2);
    expect(delays).toEqual([1_000, 2_000]);
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        event: "POINT_WORKER_BATCH_FAILED",
        errorCode: "POINT_DATABASE_UNAVAILABLE",
        consecutiveFailures: 1,
        retryDelayMs: 1_000,
      }),
    );
    expect(error.mock.calls.join(" ")).not.toContain("secret.example");
  });

  it("caps exponential retry delays", () => {
    expect(pointWorkerRetryDelay(1)).toBe(1_000);
    expect(pointWorkerRetryDelay(4)).toBe(8_000);
    expect(pointWorkerRetryDelay(20)).toBe(30_000);
  });
});
