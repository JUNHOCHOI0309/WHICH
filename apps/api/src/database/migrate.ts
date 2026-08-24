import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { sql } from "drizzle-orm";
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
  // PostgreSQL requires a newly added enum value to commit before a later
  // transaction can reference it from a constraint. Existing installations
  // therefore expand the enum in its own autocommit statement before Drizzle
  // opens the transaction that applies the remaining migrations.
  await database.db.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_type
        join pg_namespace on pg_namespace.oid = pg_type.typnamespace
        where pg_namespace.nspname = 'public'
          and pg_type.typname = 'subject_kind'
      ) then
        alter type public.subject_kind add value if not exists 'DELETED_MEMBER';
      end if;
    end
    $$
  `);
  await migrate(database.db, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await database.close();
}
