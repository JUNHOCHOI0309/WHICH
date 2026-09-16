import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rawArgs = process.argv.slice(2).filter((value) => value !== "--");
const skipCheck = rawArgs.includes("--skip-check");
const cliArgs = rawArgs.filter((value) => value !== "--skip-check");
const input = cliArgs[0];
const outputArg = cliArgs[1];
if (!input) {
  console.error("사용법: pnpm render:input -- <hyperframes-input.json> [output.mp4]");
  process.exit(1);
}

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`입력 파일을 찾을 수 없습니다: ${inputPath}`);
  process.exit(1);
}

let variables;
try {
  variables = JSON.parse(readFileSync(inputPath, "utf8"));
} catch {
  console.error("입력 파일이 올바른 JSON이 아닙니다.");
  process.exit(1);
}

for (const key of ["question", "context", "choiceA", "choiceB", "cta", "url"]) {
  if (typeof variables[key] !== "string" || !variables[key].trim()) {
    console.error(`필수 문자열이 없습니다: ${key}`);
    process.exit(1);
  }
}

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const safeName = basename(inputPath, ".json").replace(/[^a-zA-Z0-9_-]/g, "-");
const outputPath = resolve(outputArg || `renders/${safeName}.mp4`);
mkdirSync(dirname(outputPath), { recursive: true });
const npxCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
const executable = process.platform === "win32" && existsSync(npxCli) ? process.execPath : "npx";

function run(args) {
  const commandArgs = executable === process.execPath ? [npxCli, ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: projectDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!skipCheck) run(["--yes", "hyperframes@0.8.41", "check"]);
run([
  "--yes",
  "hyperframes@0.8.41",
  "render",
  ".",
  "--variables-file",
  inputPath,
  "--strict-variables",
  "--output",
  outputPath,
  "--quality",
  "looks",
]);

console.log(`렌더 완료: ${outputPath}`);
