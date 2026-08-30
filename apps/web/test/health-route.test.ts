import { beforeEach, describe, expect, it, vi } from "vitest";
const { fetchWhichApi } = vi.hoisted(() => ({ fetchWhichApi: vi.fn() }));
vi.mock("@/lib/server/which-api", () => ({ fetchWhichApi }));
import { GET } from "@/app/api/health/route";

describe("container readiness", () => {
  beforeEach(() => vi.resetAllMocks());
  it("checks API and DB readiness without caching", async () => {
    fetchWhichApi.mockResolvedValue(new Response("{}", { status: 200 }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
    expect(fetchWhichApi).toHaveBeenCalledWith("/health/ready", {
      signal: expect.any(AbortSignal),
    });
  });
  it("returns unavailable when DB readiness fails", async () => {
    fetchWhichApi.mockResolvedValue(new Response("private details", { status: 503 }));
    expect((await GET()).status).toBe(503);
  });
  it("does not disclose thrown connection details", async () => {
    fetchWhichApi.mockRejectedValue(new Error("postgresql://secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
