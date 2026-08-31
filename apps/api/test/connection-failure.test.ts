import { describe, expect, it } from "vitest";

import { getConfig } from "../src/config.js";
import { databaseConnectionFailure } from "../src/database/connection-failure.js";

describe("web database connection budget", () => {
  it("waits up to ten seconds by default and allows an explicit bounded override", () => {
    expect(getConfig({}).databaseConnectionTimeoutMillis).toBe(10_000);
    expect(
      getConfig({ DATABASE_CONNECTION_TIMEOUT_MS: "15000" }).databaseConnectionTimeoutMillis,
    ).toBe(15_000);
  });

  it.each(["0", "999", "60001", "1.5", "invalid"])("rejects invalid timeout %s", (value) => {
    expect(() => getConfig({ DATABASE_CONNECTION_TIMEOUT_MS: value })).toThrow();
  });
});

describe("safe database failure classification", () => {
  it.each([
    ["timeout exceeded when trying to connect", "POOL_CONNECT_WAIT_TIMEOUT"],
    ["Connection terminated due to connection timeout", "NEW_CONNECTION_TIMEOUT"],
  ])("recognizes a nested %s without exposing SQL or parameters", (message, kind) => {
    const error = new Error("Failed query: secret SQL parameters", { cause: new Error(message) });
    expect(databaseConnectionFailure(error)).toBe(kind);
  });

  it("does not misclassify query contents or syntax errors", () => {
    expect(
      databaseConnectionFailure(new Error("select 'timeout exceeded when trying to connect'")),
    ).toBeNull();
    expect(databaseConnectionFailure(new Error("syntax error"))).toBeNull();
    expect(databaseConnectionFailure(null)).toBeNull();
  });

  it("bounds malformed cause chains", () => {
    const error = new Error("loop");
    error.cause = error;
    expect(databaseConnectionFailure(error)).toBeNull();
  });
});
