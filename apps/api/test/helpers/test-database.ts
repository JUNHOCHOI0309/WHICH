import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { createDatabase } from "../../src/database/client.js";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

  async function dropDatabaseWhenDisconnected() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await administrationPool.query(`DROP DATABASE ${databaseName}`);
        return;
      } catch (error) {
        const databaseIsInUse =
          typeof error === "object" && error !== null && "code" in error && error.code === "55006";
        if (!databaseIsInUse || attempt === 9) throw error;
        await wait(50 * (attempt + 1));
      }
    }
  }

  await administrationPool.query(`CREATE DATABASE ${databaseName}`);

  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  const database = createDatabase(testUrl.toString());

  try {
    await migrate(database.db, { migrationsFolder });
  } catch (error) {
    await database.close();
    await dropDatabaseWhenDisconnected();
    await administrationPool.end();
    throw error;
  }

  return {
    database,
    async drop() {
      await dropDatabaseWhenDisconnected();
      await administrationPool.end();
    },
  };
}
