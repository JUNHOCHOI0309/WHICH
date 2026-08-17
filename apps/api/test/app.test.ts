import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

describe("system health", () => {
  it("reports liveness without requiring the database", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn(),
      close: vi.fn(),
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "which-api" });
  });

  it("reports readiness only when the database responds", async () => {
    const app = await buildApp(getConfig({ NODE_ENV: "test" }), {
      ping: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", service: "which-api" });
  });
});

describe("safe feature defaults", () => {
  it("keeps political capabilities disabled", () => {
    const config = getConfig({ NODE_ENV: "test" });

    expect(config.featureFlags.politicalVoting).toBe(false);
    expect(config.featureFlags.politicalComments).toBe(false);
  });
});
