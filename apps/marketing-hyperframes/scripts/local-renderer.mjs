import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.WHICH_HYPERFRAMES_PORT || 8783);
const MAX_BODY_BYTES = 32 * 1024;
const RENDER_TIMEOUT_MS = 180_000;
const REQUIRED_VARIABLES = ["question", "context", "choiceA", "choiceB", "cta", "url"];
const PRODUCTION_ORIGIN = "https://studio.whichone.site";
const PACKAGE_FILE_PATH = "/files/hyperframes-input.json";
const VIDEO_PACKAGE_PATH = "/api/video-packages";
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const renderScript = resolve(projectDir, "scripts/render-input.mjs");
let rendering = false;

export function allowedOrigin(origin) {
  if (origin === PRODUCTION_ORIGIN) return true;
  if (/^https:\/\/[0-9a-f]{8}\.which-marketing-studio-pages\.pages\.dev$/i.test(origin))
    return true;
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(origin);
}

export function corsHeaders(origin) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (allowedOrigin(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

export function validateRenderPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("INVALID_PAYLOAD");
  const id = String(payload.id || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("INVALID_PACKAGE_ID");
  if (!payload.variables || typeof payload.variables !== "object")
    throw new Error("INVALID_VARIABLES");
  const variables = {};
  for (const key of REQUIRED_VARIABLES) {
    const value = payload.variables[key];
    if (typeof value !== "string" || !value.trim() || value.length > 500)
      throw new Error(`INVALID_VARIABLE_${key.toUpperCase()}`);
    variables[key] = value.trim();
  }
  let url;
  try {
    url = new URL(variables.url);
  } catch {
    throw new Error("INVALID_VARIABLE_URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "whichone.site")
    throw new Error("INVALID_VARIABLE_URL");
  return { id, variables };
}

export function downloadName(id) {
  return `which-short-${id.slice(0, 8)}-5s.mp4`;
}

function validPackageId(value) {
  const id = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("INVALID_PACKAGE_ID");
  return id;
}

function json(response, status, headers) {
  response.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(status < 400 ? { status: "ok" } : { error: "RENDER_FAILED" }));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function runRender(inputPath, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [renderScript, inputPath, outputPath, "--skip-check"], {
      cwd: projectDir,
      windowsHide: true,
      env: process.env,
    });
    let log = "";
    const append = (chunk) => {
      log = (log + chunk.toString()).slice(-12_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("RENDER_TIMEOUT"));
    }, RENDER_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`RENDER_EXIT_${code}: ${log}`));
    });
  });
}

async function removeFiles(paths) {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})));
}

async function loadPackage(id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `${PRODUCTION_ORIGIN}/api/video-packages/${id}${PACKAGE_FILE_PATH}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error(`PACKAGE_HTTP_${response.status}`);
    return validateRenderPayload({ id, variables: await response.json() });
  } finally {
    clearTimeout(timeout);
  }
}

export function validateSourceRequest(url) {
  const sourceId = String(url.searchParams.get("sourceId") || "").toLowerCase();
  const date = String(url.searchParams.get("date") || "");
  const slot = String(url.searchParams.get("slot") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sourceId))
    throw new Error("INVALID_SOURCE_ID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  if (!new Set(["1330", "1530", "1730"]).has(slot)) throw new Error("INVALID_SLOT");
  return { sourceId, date, slot };
}

async function createPackage(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${PRODUCTION_ORIGIN}${VIDEO_PACKAGE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PRODUCTION_ORIGIN },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`PACKAGE_CREATE_HTTP_${response.status}`);
    const body = await response.json();
    return validateRenderPayload(body.package);
  } finally {
    clearTimeout(timeout);
  }
}

async function renderVideo(input, response, headers, attachment = true) {
  if (rendering) return json(response, 409, headers);
  rendering = true;
  let inputPath;
  let outputPath;
  try {
    const { id, variables } = input;
    const jobDir = resolve(tmpdir(), "which-hyperframes-renderer");
    await mkdir(jobDir, { recursive: true });
    const jobId = randomUUID();
    inputPath = resolve(jobDir, `${jobId}.json`);
    outputPath = resolve(jobDir, `${jobId}.mp4`);
    await writeFile(inputPath, `${JSON.stringify(variables, null, 2)}\n`, "utf8");
    await rm(outputPath, { force: true });
    await runRender(inputPath, outputPath);
    const info = await stat(outputPath);
    const responseHeaders = {
      ...headers,
      "content-type": "video/mp4",
      "content-length": String(info.size),
    };
    if (attachment)
      responseHeaders["content-disposition"] = `attachment; filename="${downloadName(id)}"`;
    response.writeHead(200, responseHeaders);
    await pipeline(createReadStream(outputPath), response);
  } catch (error) {
    console.error(`[which-hyperframes] ${error instanceof Error ? error.message : "UNKNOWN"}`);
    if (response.headersSent) response.destroy();
    else json(response, error?.message === "BODY_TOO_LARGE" ? 413 : 500, headers);
  } finally {
    await removeFiles([inputPath, outputPath].filter(Boolean));
    rendering = false;
  }
}

async function handleRender(request, response, headers) {
  return renderVideo(validateRenderPayload(await readJson(request)), response, headers, false);
}

export function createRendererServer() {
  return createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    const headers = corsHeaders(origin);
    const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && requestUrl.pathname === "/render-source") {
      try {
        return await renderVideo(
          await createPackage(validateSourceRequest(requestUrl)),
          response,
          headers,
        );
      } catch (error) {
        console.error(`[which-hyperframes] ${error instanceof Error ? error.message : "UNKNOWN"}`);
        return json(response, 500, headers);
      }
    }
    const directDownload = request.url?.match(/^\/render\/([0-9a-f]{64})$/i);
    if (request.method === "GET" && directDownload) {
      try {
        return await renderVideo(
          await loadPackage(validPackageId(directDownload[1])),
          response,
          headers,
        );
      } catch (error) {
        console.error(`[which-hyperframes] ${error instanceof Error ? error.message : "UNKNOWN"}`);
        return json(response, 500, headers);
      }
    }
    if (!allowedOrigin(origin)) return json(response, 403, headers);
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      return response.end();
    }
    if (request.method === "GET" && request.url === "/health") return json(response, 200, headers);
    if (request.method === "POST" && request.url === "/render")
      return handleRender(request, response, headers);
    return json(response, 404, headers);
  });
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  if (!existsSync(renderScript))
    throw new Error(`렌더 스크립트를 찾을 수 없습니다: ${renderScript}`);
  createRendererServer().listen(PORT, HOST, () => {
    console.log(`WHICH HyperFrames renderer: http://${HOST}:${PORT}`);
  });
}
