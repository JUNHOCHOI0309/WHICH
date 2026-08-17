import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle({ client: pool });

  return {
    db,
    async ping() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>;
