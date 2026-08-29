import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareModerationReports,
  createPerfectSmokeRun,
  evaluateModerationRun,
  validateGoldenDataset,
} from "./modules/moderation-evaluation/evaluator.js";
import { WHICH_100_SMOKE_GOLDEN_SET } from "./modules/moderation-evaluation/golden-set.js";

async function readJson(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function outputJson(value: unknown) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const outputPath = option("--output");
  if (outputPath) {
    await writeFile(resolve(outputPath), serialized, "utf8");
    console.log(JSON.stringify({ written: resolve(outputPath) }, null, 2));
    return;
  }
  process.stdout.write(serialized);
}

async function main() {
  const command = process.argv[2] ?? "smoke";
  if (command === "seed") {
    await outputJson(WHICH_100_SMOKE_GOLDEN_SET);
    return;
  }
  if (command === "validate") {
    const datasetPath = process.argv[3];
    const result = validateGoldenDataset(
      datasetPath ? await readJson(datasetPath) : WHICH_100_SMOKE_GOLDEN_SET,
    );
    await outputJson(result.summary);
    if (!result.summary.coverageReady) process.exitCode = 1;
    return;
  }
  if (command === "smoke") {
    const run = createPerfectSmokeRun(WHICH_100_SMOKE_GOLDEN_SET);
    await outputJson(evaluateModerationRun(WHICH_100_SMOKE_GOLDEN_SET, run));
    return;
  }
  if (command === "report") {
    const datasetPath = process.argv[3];
    const runPath = process.argv[4];
    if (!datasetPath || !runPath) {
      throw new Error(
        "Usage: moderation-evaluator report <dataset.json> <run.json> [--baseline baseline-run.json] [--output report.json]",
      );
    }
    const dataset = await readJson(datasetPath);
    const report = evaluateModerationRun(dataset, await readJson(runPath));
    const baselinePath = option("--baseline");
    await outputJson(
      baselinePath
        ? {
            report,
            regression: compareModerationReports(
              report,
              evaluateModerationRun(dataset, await readJson(baselinePath)),
            ),
          }
        : report,
    );
    return;
  }
  throw new Error(`Unknown Moderation Evaluator command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
