import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDatabase } from "../../src/database/client.js";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

export async function createTestDatabase() {
  const sourceUrl = new URL(
    process.env.DATABASE_URL ?? "postgresql://which:which_local@localhost:54329/which",
  );
  const databaseName = `which_test_${process.pid}_${randomBytes(6).toString("hex")}`;

  if (!/^which_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("Generated an unsafe test database name.");
  }

  const administrationUrl = new URL(sourceUrl);
  administrationUrl.pathname = "/postgres";
  const administrationPool = new Pool({ connectionString: administrationUrl.toString() });

  await administrationPool.query(`CREATE DATABASE ${databaseName}`);

  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  const database = createDatabase(testUrl.toString());

  try {
    await migrate(database.db, { migrationsFolder });
  } catch (error) {
    await database.close();
    await administrationPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await administrationPool.end();
    throw error;
  }

  return {
    database,
    async drop() {
      await administrationPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      await administrationPool.end();
    },
  };
}
