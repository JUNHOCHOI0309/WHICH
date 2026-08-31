import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(
  databaseUrl: string,
  options: { connectionTimeoutMillis?: number } = {},
) {
  const connectionTimeoutMillis = options.connectionTimeoutMillis ?? 2_000;
  if (
    !Number.isInteger(connectionTimeoutMillis) ||
    connectionTimeoutMillis < 1 ||
    connectionTimeoutMillis > 60_000
  ) {
    throw new Error("DATABASE_CONNECTION_TIMEOUT_INVALID");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle({ client: pool });

  return {
    db,
    connectionDiagnostics() {
      return {
        connectionTimeoutMillis,
        maxConnections: 10,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      };
    },
    async ping() {
      await pool.query("select 1");
    },
    async close() {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>;
