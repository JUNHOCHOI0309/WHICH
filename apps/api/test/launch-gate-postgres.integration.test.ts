import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { outboxEvents } from "../src/database/schema/index.js";
import { createPostgresLaunchGateStore } from "../src/modules/launch-gate/postgres-store.js";
import { createTestDatabase } from "./helpers/test-database.js";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

type MigrationJournal = {
  entries: unknown[];
};

const databases: TestDatabase[] = [];
const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  const createdDatabases = databases.splice(0);
  await Promise.all(createdDatabases.map((database) => database.database.close()));
  await Promise.all(createdDatabases.map((database) => database.drop()));
}, 30_000);

describe("PostgreSQL launch gate store", () => {
  it("captures migration, Outbox, and protected fact baselines without writing", async () => {
    const testDatabase = await createTestDatabase();
    databases.push(testDatabase);
    const pool = new Pool({ connectionString: testDatabase.databaseUrl });
    pools.push(pool);
    const eventId = "40000000-0000-4000-8000-000000000001";
    await testDatabase.database.db.insert(outboxEvents).values({
      id: eventId,
      aggregateType: "TEST",
      aggregateId: "launch-gate",
      eventType: "GATE_TESTED",
      schemaVersion: 1,
      payload: { event_id: eventId },
    });

    const store = createPostgresLaunchGateStore(pool);
    const baseline = await store.captureRollbackBaseline();
    const sameFacts = await store.readProtectedFacts(baseline.capturedAt);
    const migrationJournal = JSON.parse(
      await readFile(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
    ) as MigrationJournal;

    expect(baseline.appliedMigrationTimestamps).toHaveLength(migrationJournal.entries.length);
    expect(baseline.outbox).toMatchObject({ total: 1, pending: 1, failed: 0 });
    expect(baseline.protectedFacts).toEqual(sameFacts);

    await testDatabase.database.db.delete(outboxEvents);
    const changedFacts = await store.readProtectedFacts(baseline.capturedAt);
    expect(changedFacts.outboxEvents).not.toEqual(baseline.protectedFacts.outboxEvents);
  });
});
