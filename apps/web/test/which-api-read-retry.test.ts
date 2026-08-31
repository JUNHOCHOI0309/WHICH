import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWhichApi } from "@/lib/server/which-api";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("API_BASE_URL", "http://localhost:4000");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bounded member read retries", () => {
  it("bounds both hung attempts to twelve seconds each", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const upstream = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", upstream);
    const pending = expect(fetchWhichApi("/v1/me")).rejects.toHaveProperty("name", "TimeoutError");
    await vi.advanceTimersByTimeAsync(24_300);
    await pending;
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(timeout.mock.calls).toEqual([[12_000], [12_000]]);
  });

  it.each([
    "/v1/me?limit=3",
    "/v1/me/points?limit=5",
    "/v1/me/point-shop",
    "/v1/member/issue-submissions?limit=20",
    "/v1/member-session",
  ])("recovers %s after one transient failure, retaining request identity", async (path) => {
    const success = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(success);
    vi.stubGlobal("fetch", upstream);
    const pending = fetchWhichApi(path, { headers: { authorization: "Bearer test-token" } });
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe(success);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[0]![0])).toBe(`http://localhost:4000${path}`);
    expect(String(upstream.mock.calls[1]![0])).toBe(`http://localhost:4000${path}`);
    for (const [, init] of upstream.mock.calls) {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeDefined();
    }
  });

  it.each([500, 502, 503, 504])(
    "returns the final %s after exactly two attempts",
    async (status) => {
      const first = new Response("first", { status });
      const last = new Response("last", { status });
      const upstream = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last);
      vi.stubGlobal("fetch", upstream);
      const pending = fetchWhichApi("/v1/me");
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBe(last);
      expect(await last.text()).toBe("last");
      expect(upstream).toHaveBeenCalledTimes(2);
    },
  );

  it.each([200, 400, 401, 403, 404, 409, 422, 429])("does not retry HTTP %s", async (status) => {
    const response = new Response("unchanged", { status });
    const upstream = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", upstream);
    expect(await fetchWhichApi("/v1/me")).toBe(response);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("never retries %s mutations", async (method) => {
    const upstream = vi.fn().mockResolvedValue(new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", upstream);
    expect((await fetchWhichApi("/v1/me", { method })).status).toBe(500);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("does not retry unreviewed GET endpoints such as token exchanges", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response("failed", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    await fetchWhichApi("/v1/auth/exchange?token=example");
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("recovers a fetch transport error once", async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    const pending = fetchWhichApi("/v1/me");
    await vi.advanceTimersByTimeAsync(300);
    expect((await pending).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("propagates the second transport failure without looping", async () => {
    const upstream = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", upstream);
    const pending = expect(fetchWhichApi("/v1/me")).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(300);
    await pending;
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("does not retry a programming error", async () => {
    const upstream = vi.fn().mockRejectedValue(new Error("unexpected"));
    vi.stubGlobal("fetch", upstream);
    await expect(fetchWhichApi("/v1/me")).rejects.toThrow("unexpected");
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("respects caller cancellation before the retry", async () => {
    const controller = new AbortController();
    const upstream = vi.fn().mockResolvedValue(new Response("temporary", { status: 500 }));
    vi.stubGlobal("fetch", upstream);
    const pending = expect(
      fetchWhichApi("/v1/me", { signal: controller.signal }),
    ).rejects.toHaveProperty("name", "AbortError");
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(upstream).toHaveBeenCalledOnce();
  });
});
