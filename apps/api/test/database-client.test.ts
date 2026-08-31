import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
  end: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("pg", () => ({
  Pool: class {
    query = mocks.query;
    end = mocks.end;
    totalCount = 4;
    idleCount = 2;
    waitingCount = 1;
    constructor(options: unknown) {
      mocks.pool(options);
    }
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn(() => ({})) }));

import { createDatabase } from "../src/database/client.js";

const url = "postgresql://test:example@db.example.com/which?sslmode=verify-full";

describe("database connection timeouts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the generic default and verified TLS connection string", async () => {
    const database = createDatabase(url);
    expect(mocks.pool).toHaveBeenCalledWith({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
    });
    await database.ping();
    await database.close();
    expect(mocks.query).toHaveBeenCalledWith("select 1");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("exposes only safe pool counters and the effective timeout", () => {
    const database = createDatabase(url, { connectionTimeoutMillis: 10_000 });
    expect(database.connectionDiagnostics()).toEqual({
      connectionTimeoutMillis: 10_000,
      maxConnections: 10,
      totalConnections: 4,
      idleConnections: 2,
      waitingRequests: 1,
    });
  });

  it("allows a bounded cold-worker timeout without changing other pool settings", () => {
    createDatabase(url, { connectionTimeoutMillis: 10_000 });
    expect(mocks.pool).toHaveBeenCalledWith({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it.each([0, -1, 60_001, 1.5, NaN, Infinity])("rejects invalid timeout %s", (timeout) => {
    expect(() => createDatabase(url, { connectionTimeoutMillis: timeout })).toThrow(
      "DATABASE_CONNECTION_TIMEOUT_INVALID",
    );
    expect(mocks.pool).not.toHaveBeenCalled();
  });
});
