import { describe, expect, it, vi } from "vitest";
import { waitForPollDatabase } from "../src/modules/operations/poll-sync-startup.js";

describe("poll sync database readiness", () => {
  it("continues immediately when the database is ready", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn();
    await waitForPollDatabase(ping, new AbortController().signal, wait);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries read-only connection checks after cold-start failures", async () => {
    const ping = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const signal = new AbortController().signal;
    await waitForPollDatabase(ping, signal, wait);
    expect(ping).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5_000, signal);
  });

  it("bounds attempts and never exposes database error details", async () => {
    const ping = vi.fn().mockRejectedValue(new Error("private connection details"));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(waitForPollDatabase(ping, new AbortController().signal, wait)).rejects.toThrow(
      "POLL_DATABASE_NOT_READY",
    );
    expect(ping).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("does not connect after cancellation", async () => {
    const stop = new AbortController();
    stop.abort();
    const ping = vi.fn();
    await expect(waitForPollDatabase(ping, stop.signal)).rejects.toThrow();
    expect(ping).not.toHaveBeenCalled();
  });

  it("does not retry when cancellation happens during a connection check", async () => {
    const stop = new AbortController();
    const ping = vi.fn(() => {
      stop.abort();
      return Promise.reject(new Error("timeout"));
    });
    const wait = vi.fn();
    await expect(waitForPollDatabase(ping, stop.signal, wait)).rejects.toThrow();
    expect(ping).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
