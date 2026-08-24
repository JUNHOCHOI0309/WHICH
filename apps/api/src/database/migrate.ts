import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./client.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));
const database = createDatabase(databaseUrl);

try {
  await migrate(database.db, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await database.close();
}
