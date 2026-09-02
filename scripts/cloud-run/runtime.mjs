import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function runtimeEnvironment(environment = process.env, readFile = readFileSync) {
  const stored = environment.CLOUD_RUN_ENV_FILE
    ? JSON.parse(readFile(environment.CLOUD_RUN_ENV_FILE, "utf8"))
    : {};
  if (
    !stored ||
    Array.isArray(stored) ||
    Object.values(stored).some((value) => typeof value !== "string")
  ) {
    throw new Error("CLOUD_RUN_SECRET_FORMAT_INVALID");
  }
  // Deployment overrides always win over the imported Render configuration.
  const result = { ...stored, ...environment };
  const port = Number(environment.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 4000) {
    throw new Error("CLOUD_RUN_PORT_INVALID");
  }
  Object.assign(result, {
    NODE_ENV: "production",
    PORT: String(port),
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    API_BASE_URL: "http://127.0.0.1:4000",
    RELEASE_ID: environment.RELEASE_ID ?? environment.K_REVISION ?? "",
  });
  for (const key of [
    "DATABASE_URL",
    "INTERNAL_AUTH_SECRET",
    "MODERATION_INTERNAL_SECRET",
    "AUTH_FLOW_SECRET",
    "RELEASE_ID",
  ]) {
    if (!result[key]) throw new Error(`CLOUD_RUN_REQUIRED_${key}`);
  }
  const database = new URL(result.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error("CLOUD_RUN_DATABASE_INVALID");
  if (
    environment.K_SERVICE &&
    (!database.hostname.includes(".") || /^(localhost|127\.)/.test(database.hostname))
  ) {
    throw new Error("CLOUD_RUN_DATABASE_EXTERNAL_ADDRESS_REQUIRED");
  }
  if (environment.K_SERVICE && database.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("CLOUD_RUN_DATABASE_VERIFIED_TLS_REQUIRED");
  }
  if (result.CLOUD_RUN_PREVIEW !== "false") {
    // A preview must never become a second production consumer on the shared DB.
    Object.assign(result, {
      POINTS_WORKER_ENABLED: "false",
      MODERATION_WORKER_ENABLED: "false",
      MODERATION_JOB_DISPATCH_ENABLED: "false",
      MODERATION_PROVIDER_MODE: "OFF",
      MODERATION_PROVIDER_KILL_SWITCH: "true",
      MODERATION_POLICY_JUDGE_MODE: "OFF",
      MODERATION_POLICY_JUDGE_KILL_SWITCH: "true",
      MODERATION_DECISION_MODE: "OFF",
      MODERATION_DECISION_KILL_SWITCH: "true",
      ISSUE_MEDIA_AUTO_PUBLICATION_MODE: "OFF",
      ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH: "true",
    });
  }
  return result;
}

export function serviceDefinitions(environment, root = process.cwd()) {
  if (
    environment.MODERATION_JOB_DISPATCH_ENABLED === "true" &&
    environment.MODERATION_WORKER_ENABLED === "true"
  )
    throw new Error("CLOUD_RUN_MODERATION_WORKLOAD_CONFLICT");
  return [
    { name: "api", cwd: resolve(root, "apps/api"), args: ["dist/server.js"], env: environment },
    {
      name: "web",
      cwd: resolve(root, "apps/web"),
      args: ["server.js"],
      env: { ...environment, HOSTNAME: "0.0.0.0" },
    },
    ...(environment.POINTS_WORKER_ENABLED === "true"
      ? [
          {
            name: "points",
            cwd: resolve(root, "apps/api"),
            args: ["dist/point-worker.js", "run"],
            env: environment,
          },
        ]
      : []),
    ...(environment.MODERATION_WORKER_ENABLED === "true"
      ? [
          {
            name: "moderation",
            cwd: resolve(root, "apps/api"),
            args: ["dist/moderation-worker.js", "run"],
            env: environment,
          },
        ]
      : []),
    ...(environment.MODERATION_JOB_DISPATCH_ENABLED === "true"
      ? [
          {
            name: "moderation-dispatch",
            cwd: resolve(root, "apps/api"),
            args: ["dist/moderation-job-dispatcher.js"],
            env: environment,
          },
        ]
      : []),
  ];
}

// Cloud Run Jobs must finish. The web service uses the long-running `run`
// command, while an isolated Job consumes one locked moderation batch and
// exits. This keeps OCR/model work out of the HTTP process without silently
// converting a preview or an OFF rollout into a paid worker.
export function moderationJobDefinition(environment, root = process.cwd()) {
  if (environment.CLOUD_RUN_PREVIEW !== "false")
    throw new Error("CLOUD_RUN_MODERATION_JOB_PREVIEW_FORBIDDEN");
  if (environment.MODERATION_WORKER_ENABLED !== "true")
    throw new Error("CLOUD_RUN_MODERATION_JOB_DISABLED");
  return {
    name: "moderation-job",
    cwd: resolve(root, "apps/api"),
    args: ["dist/moderation-worker.js", "once"],
    env: environment,
  };
}

export function moderationTaskServiceDefinition(environment, root = process.cwd()) {
  if (environment.CLOUD_RUN_PREVIEW !== "false")
    throw new Error("CLOUD_RUN_MODERATION_TASK_PREVIEW_FORBIDDEN");
  if (
    environment.MODERATION_WORKER_ENABLED !== "true" ||
    environment.MODERATION_SUBMISSION_WAKEUPS_ONLY !== "true"
  )
    throw new Error("CLOUD_RUN_MODERATION_TASK_DISABLED");
  return {
    name: "moderation-task",
    cwd: resolve(root, "apps/api"),
    args: ["dist/moderation-worker.js", "submission"],
    env: environment,
  };
}
