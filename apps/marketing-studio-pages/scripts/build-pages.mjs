import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(appDir, "dist");

await mkdir(distDir, { recursive: true });
await copyFile(resolve(appDir, "src/worker.js"), resolve(distDir, "_worker.js"));

console.log("Built dist/_worker.js for Cloudflare Pages advanced mode.");
