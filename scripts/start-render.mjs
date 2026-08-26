import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const apiPort = process.env.API_PORT ?? "4000";

function start(name, args, environment) {
  const child = spawn(pnpm, args, {
    env: { ...process.env, ...environment },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  child.serviceName = name;
  return child;
}

const services = [
  start("api", ["--filter", "@which/api", "start"], {
    API_HOST: "127.0.0.1",
    API_PORT: apiPort,
  }),
  start("web", ["--filter", "@which/web", "start"], {
    API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  }),
  start("points", ["--filter", "@which/api", "points:worker:prod"], {}),
];

let shuttingDown = false;
let exitCode = 0;
let remaining = services.length;

function stopServices(code, signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;

  for (const service of services) {
    if (service.exitCode === null && service.signalCode === null) service.kill(signal);
  }

  setTimeout(() => {
    for (const service of services) {
      if (service.exitCode === null && service.signalCode === null) service.kill("SIGKILL");
    }
  }, 10_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopServices(0, signal));
}

for (const service of services) {
  service.once("error", (error) => {
    console.error(`[render] Failed to start ${service.serviceName}:`, error);
    stopServices(1);
  });

  service.once("exit", (code, signal) => {
    remaining -= 1;
    if (!shuttingDown) {
      console.error(
        `[render] ${service.serviceName} stopped unexpectedly (code=${code}, signal=${signal}).`,
      );
      stopServices(code ?? 1);
    }
    if (remaining === 0) process.exit(exitCode);
  });
}
