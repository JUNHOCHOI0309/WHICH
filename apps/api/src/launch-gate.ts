import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";
import { Pool } from "pg";
import { z } from "zod";

import { getLaunchGateConfig } from "./modules/launch-gate/config.js";
import type { MigrationExpectation, RollbackSnapshot } from "./modules/launch-gate/contracts.js";
import { createHttpLaunchGateProbe } from "./modules/launch-gate/http-probe.js";
import { createPostgresLaunchGateStore } from "./modules/launch-gate/postgres-store.js";
import {
  createRollbackSnapshot,
  runLaunchGate,
  verifyRollback,
} from "./modules/launch-gate/service.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const journalSchema = z.object({
  entries: z.array(
    z.object({
      tag: z.string().min(1),
      when: z.number().int().nonnegative(),
    }),
  ),
});

const rollbackSnapshotSchema: z.ZodType<RollbackSnapshot> = z.object({
  schemaVersion: z.literal(1),
  snapshotType: z.literal("WHICH_ROLLBACK_V1"),
  capturedAt: z.string(),
  sourceReleaseId: z.string(),
  rollbackTargetReleaseId: z.string(),
  targetEnvironment: z.enum(["development", "staging", "production"]),
  database: z.object({
    capturedAt: z.string(),
    appliedMigrationTimestamps: z.array(z.number()),
    outbox: z.object({
      total: z.number(),
      pending: z.number(),
      published: z.number(),
      failed: z.number(),
      oldestPendingAgeSeconds: z.number().nullable(),
    }),
    protectedFacts: z.object({
      votes: z.object({ count: z.number(), digest: z.string() }),
      outboxEvents: z.object({ count: z.number(), digest: z.string() }),
    }),
  }),
});

async function loadExpectedMigrations(): Promise<MigrationExpectation[]> {
  const path = fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url));
  const journal = journalSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return journal.entries.map((entry) => ({ tag: entry.tag, appliedAt: entry.when }));
}

async function saveJson(path: string | undefined, value: unknown) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (path) {
    const output = resolve(path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, json, { encoding: "utf8", flag: "wx" });
    console.error(`Saved report: ${output}`);
  }
  process.stdout.write(json);
}

function usage() {
  return [
    "Usage:",
    "  launch-gate run [report.json]",
    "  launch-gate snapshot <snapshot.json> <rollback-target-release-id>",
    "  launch-gate verify <snapshot.json> [report.json]",
  ].join("\n");
}

async function main() {
  const command = process.argv[2] ?? "run";
  const expectedMigrations = await loadExpectedMigrations();
  const config = getLaunchGateConfig(process.env, expectedMigrations);
  const databaseUrl = z.string().url().parse(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_000 });
  const store = createPostgresLaunchGateStore(pool);
  const api = createHttpLaunchGateProbe({
    apiBaseUrl: config.apiBaseUrl,
    internalAuthSecret: config.internalAuthSecret,
    issueId: config.issueId,
    issueVersion: config.issueVersion,
  });

  try {
    if (command === "run") {
      const report = await runLaunchGate(config, { store, api });
      await saveJson(process.argv[3], report);
      if (report.verdict !== "GO") process.exitCode = 1;
      return;
    }
    if (command === "snapshot") {
      const path = process.argv[3];
      const target = process.argv[4];
      if (!path || !target) throw new Error(usage());
      const snapshot = await createRollbackSnapshot(config, target, { store, api });
      await saveJson(path, snapshot);
      return;
    }
    if (command === "verify") {
      const snapshotPath = process.argv[3];
      if (!snapshotPath) throw new Error(usage());
      const snapshot = rollbackSnapshotSchema.parse(
        JSON.parse(await readFile(resolve(snapshotPath), "utf8")),
      );
      const report = await verifyRollback(snapshot, { store, api });
      await saveJson(process.argv[4], report);
      if (report.verdict !== "VERIFIED") process.exitCode = 1;
      return;
    }
    throw new Error(usage());
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
