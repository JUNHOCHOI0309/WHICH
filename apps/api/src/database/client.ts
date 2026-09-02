import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(
  databaseUrl: string,
  options: { connectionTimeoutMillis?: number; maxConnections?: number } = {},
) {
  const connectionTimeoutMillis = options.connectionTimeoutMillis ?? 2_000;
  const maxConnections = options.maxConnections ?? 10;
  if (
    !Number.isInteger(connectionTimeoutMillis) ||
    connectionTimeoutMillis < 1 ||
    connectionTimeoutMillis > 60_000
  ) {
    throw new Error("DATABASE_CONNECTION_TIMEOUT_INVALID");
  }
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 20) {
    throw new Error("DATABASE_MAX_CONNECTIONS_INVALID");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle({ client: pool });

  return {
    db,
    connectionDiagnostics() {
      return {
        connectionTimeoutMillis,
        maxConnections,
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
