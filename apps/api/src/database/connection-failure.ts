// Drizzle wraps pg errors with SQL and parameters. Inspect causes, but never
// return/log their raw messages, credentials, session hashes, or query values.
export function databaseConnectionFailure(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    if (current.message === "timeout exceeded when trying to connect") {
      return "POOL_CONNECT_WAIT_TIMEOUT";
    }
    if (current.message === "Connection terminated due to connection timeout") {
      return "NEW_CONNECTION_TIMEOUT";
    }
    current = current.cause;
  }
  return null;
}
