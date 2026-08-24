import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { z } from "zod";

import { createDatabase } from "./database/client.js";
import {
  issuePublicationTargetSchema,
  loadIssueManifest,
} from "./modules/issue-publication/manifest.js";
import { loadIssueInventoryReadiness } from "./modules/issue-publication/inventory.js";
import {
  assertIssuePublicationConfirmation,
  assertIssuePublicationTarget,
  IssuePublicationConflictError,
  planIssuePublication,
  publishIssueManifest,
} from "./modules/issue-publication/service.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

function usage() {
  return [
    "Usage:",
    "  issue-publisher validate <manifest.json>",
    "  issue-publisher readiness <inventory-policy.json>",
    "  issue-publisher dry-run <manifest.json> --target <development|staging|production>",
    "  issue-publisher publish <manifest.json> --target <environment> --confirm <environment:pack-id:manifest-sha256>",
  ].join("\n");
}

function readOption(arguments_: string[], name: string) {
  const indexes = arguments_.flatMap((argument, index) => (argument === name ? [index] : []));
  if (indexes.length === 0) return undefined;
  if (indexes.length > 1) throw new Error(`${name} may only be provided once.\n${usage()}`);
  const value = arguments_[indexes[0]! + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.\n${usage()}`);
  return value;
}

function assertKnownArguments(arguments_: string[], command: string) {
  const allowed = new Set(
    command === "publish" ? ["--target", "--confirm"] : command === "dry-run" ? ["--target"] : [],
  );
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}\n${usage()}`);
    if (!allowed.has(argument)) throw new Error(`Unknown option: ${argument}\n${usage()}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${argument} requires a value.\n${usage()}`);
    index += 1;
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const command = arguments_[0];
  const manifestPath = arguments_[1];
  if (
    !command ||
    !manifestPath ||
    !["validate", "readiness", "dry-run", "publish"].includes(command)
  ) {
    throw new Error(usage());
  }
  assertKnownArguments(arguments_.slice(2), command);

  if (command === "readiness") {
    const report = await loadIssueInventoryReadiness(manifestPath);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
    return;
  }

  const loaded = await loadIssueManifest(manifestPath);
  if (command === "validate") {
    console.log(
      JSON.stringify(
        {
          valid: true,
          path: loaded.path,
          packId: loaded.manifest.packId,
          manifestDigest: loaded.manifestDigest,
          target: loaded.manifest.target,
          issueCount: loaded.manifest.issues.length,
          approval: loaded.manifest.approval,
        },
        null,
        2,
      ),
    );
    return;
  }

  const target = issuePublicationTargetSchema.parse(readOption(arguments_, "--target"));
  assertIssuePublicationTarget(loaded.manifest, target);
  if (command === "publish") {
    assertIssuePublicationConfirmation(
      loaded.manifest,
      target,
      loaded.manifestDigest,
      readOption(arguments_, "--confirm"),
    );
  }

  const databaseUrl = z.string().url().parse(process.env.DATABASE_URL);
  const database = createDatabase(databaseUrl);
  try {
    const result =
      command === "dry-run"
        ? await planIssuePublication(database.db, loaded.manifest, loaded.manifestDigest)
        : await publishIssueManifest(database.db, loaded.manifest, loaded.manifestDigest);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof IssuePublicationConflictError) {
    console.error(JSON.stringify(error.plan, null, 2));
  } else if (error instanceof z.ZodError) {
    console.error(JSON.stringify({ error: "VALIDATION_FAILED", issues: error.issues }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
