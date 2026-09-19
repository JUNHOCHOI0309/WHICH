import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertLocalRadarDatabase,
  assertNoEnvironmentFiles,
  localRadarEnvironment,
} from "./profile.mjs";

test("isolates inherited credentials, remote DB, cloud and Node injection settings", () => {
  const env = localRadarEnvironment({
    PATH: "local-path",
    DATABASE_URL: "postgresql://remote/prod",
    OPENAI_API_KEY: "secret",
    R2_SECRET_ACCESS_KEY: "secret",
    GOOGLE_APPLICATION_CREDENTIALS: "remote.json",
    NODE_OPTIONS: "--import bad.mjs",
    API_BASE_URL: "https://whichone.site",
    RESEND_API_KEY: "secret",
    HTTP_PROXY: "https://remote",
    MODERATION_PROVIDER_MODE: "LIVE",
  });
  assert.equal(env.PATH, "local-path");
  for (const key of [
    "OPENAI_API_KEY",
    "R2_SECRET_ACCESS_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "NODE_OPTIONS",
    "RESEND_API_KEY",
    "HTTP_PROXY",
  ])
    assert.equal(env[key], undefined);
  assertLocalRadarDatabase(env.DATABASE_URL);
  assert.equal(env.API_BASE_URL, "http://127.0.0.1:4000");
  assert.equal(env.MODERATION_PROVIDER_MODE, "OFF");
  assert.equal(env.MODERATION_PROVIDER_DAILY_CALL_CAP, "0");
  assert.equal(env.MODERATION_JOB_DISPATCH_ENABLED, "false");
  assert.equal(env.POLL_SYNC_ENABLED, "false");
  assert.equal(env.INTERNAL_AUTH_SECRET, env.AUTH_INTERNAL_SECRET);
});

test("rejects remote, shared and query-overridden DB targets", () => {
  for (const value of [
    "postgresql://which_radar:pw@remote:54339/which_radar",
    "postgresql://which:pw@127.0.0.1:54329/which",
    "postgresql://which_radar:pw@127.0.0.1:54339/production",
    "postgresql://which_radar:pw@127.0.0.1:54339/which_radar?host=remote",
  ])
    assert.throws(() => assertLocalRadarDatabase(value));
});

test("rejects automatic dotenv loading instead of overwriting user files", () => {
  assertNoEnvironmentFiles([".env.example", "package.json"]);
  for (const name of [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".ENV.LOCAL",
  ])
    assert.throws(() => assertNoEnvironmentFiles([name]));
});

test("dedicated database port is only bound on loopback and retains its own volume", () => {
  const compose = readFileSync(new URL("../../infra/compose.radar.yaml", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:54339:5432/);
  assert.match(compose, /radar-postgres-data/);
  assert.match(compose, /name: which-radar-local/);
});
