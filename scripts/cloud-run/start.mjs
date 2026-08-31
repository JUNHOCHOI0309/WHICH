import { spawn } from "node:child_process";
import { runtimeEnvironment, serviceDefinitions } from "./runtime.mjs";

let environment;
try {
  environment = runtimeEnvironment();
} catch (error) {
  // Do not log parsed environment values, URLs, or a Zod issue payload.
  console.error(
    "[cloud-run] Runtime configuration failed.",
    error instanceof Error && error.message.startsWith("CLOUD_RUN_")
      ? error.message
      : "INVALID_CONFIGURATION",
  );
  process.exit(1);
}
const children = [];
let stopping = false;
let resultCode = 0;
let remaining = 0;
function stop(code) {
  if (stopping) return;
  stopping = true;
  resultCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  // Cloud Run grants only 10 seconds; leave time for PID 1 to exit.
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 8_000).unref();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop(0));
for (const definition of serviceDefinitions(environment)) {
  const child = spawn(process.execPath, definition.args, {
    cwd: definition.cwd,
    env: definition.env,
    stdio: "inherit",
  });
  children.push(child);
  remaining += 1;
  child.once("error", () => {
    console.error(`[cloud-run] ${definition.name} failed to start.`);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`[cloud-run] ${definition.name} exited unexpectedly.`);
      stop(code || 1);
    }
  });
  child.once("close", () => {
    remaining -= 1;
    if (remaining === 0) process.exit(resultCode);
  });
}
console.info(
  `[cloud-run] Started ${children.length} processes; preview=${environment.CLOUD_RUN_PREVIEW !== "false"}.`,
);
