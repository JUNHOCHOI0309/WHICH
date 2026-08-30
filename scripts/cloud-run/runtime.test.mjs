import test from "node:test";
import assert from "node:assert/strict";
import { runtimeEnvironment, serviceDefinitions } from "./runtime.mjs";

const base = {
  K_SERVICE: "which-web",
  K_REVISION: "which-web-test",
  DATABASE_URL: "postgresql://test:secret@db.example.com/which?sslmode=verify-full",
  INTERNAL_AUTH_SECRET: "test-internal-secret",
  MODERATION_INTERNAL_SECRET: "test-moderation-secret",
  AUTH_FLOW_SECRET: "test-flow-secret",
};
test("preview defaults to no consumers and no paid calls", () => {
  const env = runtimeEnvironment({
    ...base,
    POINTS_WORKER_ENABLED: "true",
    MODERATION_WORKER_ENABLED: "true",
  });
  assert.deepEqual(
    serviceDefinitions(env).map((x) => x.name),
    ["api", "web"],
  );
  assert.equal(env.MODERATION_PROVIDER_MODE, "OFF");
  assert.equal(env.ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH, "true");
});
test("deployment overrides imported environment, runtime identity and ports are isolated", () => {
  const env = runtimeEnvironment({ ...base, CLOUD_RUN_ENV_FILE: "/secret/env", PORT: "9090" }, () =>
    JSON.stringify({
      PORT: "10000",
      API_HOST: "0.0.0.0",
      RELEASE_ID: "old-render",
      FEATURE_COMMENTS_ENABLED: "true",
      AUTH_FLOW_SECRET: "old",
    }),
  );
  assert.equal(env.AUTH_FLOW_SECRET, base.AUTH_FLOW_SECRET);
  assert.equal(env.RELEASE_ID, base.K_REVISION);
  assert.equal(env.PORT, "9090");
  assert.equal(env.API_HOST, "127.0.0.1");
  assert.equal(env.API_BASE_URL, "http://127.0.0.1:4000");
  assert.equal(env.FEATURE_COMMENTS_ENABLED, "true");
  assert.equal(serviceDefinitions(env)[1].env.HOSTNAME, "0.0.0.0");
});
test("workers require explicit production switch and individual enabling", () => {
  const env = runtimeEnvironment({
    ...base,
    CLOUD_RUN_PREVIEW: "false",
    POINTS_WORKER_ENABLED: "true",
    MODERATION_WORKER_ENABLED: "true",
  });
  assert.deepEqual(
    serviceDefinitions(env).map((x) => x.name),
    ["api", "web", "points", "moderation"],
  );
});
test("internal Render DB or unverified external TLS fails closed without secret leakage", () => {
  for (const url of [
    "postgresql://u:secret@dpg-internal/db",
    "postgresql://u:secret@db.example.com/db?sslmode=require",
  ]) {
    assert.throws(() => runtimeEnvironment({ ...base, DATABASE_URL: url }), /CLOUD_RUN_DATABASE_/);
  }
});
test("invalid ports and missing production secrets fail before spawning", () => {
  for (const port of ["abc", "4000", "0", "65536"])
    assert.throws(() => runtimeEnvironment({ ...base, PORT: port }), /CLOUD_RUN_PORT_INVALID/);
  assert.throws(
    () => runtimeEnvironment({ ...base, AUTH_FLOW_SECRET: "" }),
    /CLOUD_RUN_REQUIRED_AUTH_FLOW_SECRET/,
  );
});
