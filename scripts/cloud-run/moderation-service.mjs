import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { moderationTaskServiceDefinition, runtimeEnvironment } from "./runtime.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2_048;
const TASK_TIMEOUT_MS = 280_000;

let definition;
try {
  definition = moderationTaskServiceDefinition(runtimeEnvironment());
} catch (error) {
  console.error(
    "[cloud-run] Moderation task service configuration failed.",
    error instanceof Error && error.message.startsWith("CLOUD_RUN_")
      ? error.message
      : "INVALID_CONFIGURATION",
  );
  process.exit(1);
}

let active = null;
let stopping = false;

function reply(response, status, body = "") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && path === "/health") {
    reply(response, stopping ? 503 : 200, stopping ? "stopping" : "ok");
    return;
  }
  if (request.method !== "POST" || path !== "/moderate") {
    reply(response, 404, "not found");
    return;
  }
  if (!request.headers["x-cloudtasks-taskname"]) {
    reply(response, 403, "task identity required");
    return;
  }
  if (stopping || active) {
    reply(response, 503, "worker busy");
    return;
  }
  let body;
  try {
    body = await readJson(request);
  } catch {
    reply(response, 400, "invalid task body");
    return;
  }
  if (!body || !UUID.test(body.eventId) || !UUID.test(body.claimToken)) {
    reply(response, 400, "invalid task binding");
    return;
  }

  const child = spawn(process.execPath, [...definition.args, body.eventId, body.claimToken], {
    cwd: definition.cwd,
    env: definition.env,
    stdio: "inherit",
  });
  active = child;
  const timer = setTimeout(() => child.kill("SIGKILL"), TASK_TIMEOUT_MS);
  let settled = false;
  const finish = (status, message = "") => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    active = null;
    reply(response, status, message);
  };
  child.once("error", () => {
    finish(503, "worker start failed");
  });
  child.once("exit", (code, signal) => {
    if (signal || code !== 0) finish(503, "worker failed");
    else finish(204);
  });
});

server.requestTimeout = TASK_TIMEOUT_MS + 10_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");

function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    if (!active) process.exit(0);
  });
  if (active) active.kill("SIGTERM");
  setTimeout(() => {
    if (active) active.kill("SIGKILL");
    process.exit(0);
  }, 8_000).unref();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
