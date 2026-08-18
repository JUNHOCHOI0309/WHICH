import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  LaunchGateStore,
  OutboxHealth,
  ProtectedFactDigest,
  ProtectedFacts,
  RollbackBaseline,
} from "./contracts.js";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function numberValue(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

async function readMigrations(queryable: Queryable) {
  const result = await queryable.query<{ createdAt: string }>(
    'select created_at::text as "createdAt" from drizzle.__drizzle_migrations order by created_at',
  );
  return result.rows.map((row) => numberValue(row.createdAt));
}

async function readOutbox(queryable: Queryable): Promise<OutboxHealth> {
  const result = await queryable.query<{
    total: number;
    pending: number;
    published: number;
    failed: number;
    oldestPendingAgeSeconds: number | null;
  }>(`select
      count(*)::int as "total",
      count(*) filter (where status = 'PENDING')::int as "pending",
      count(*) filter (where status = 'PUBLISHED')::int as "published",
      count(*) filter (where status = 'FAILED')::int as "failed",
      extract(epoch from (transaction_timestamp() - min(occurred_at) filter (where status = 'PENDING')))::double precision as "oldestPendingAgeSeconds"
    from outbox_events`);
  const row = result.rows[0];
  if (!row) throw new Error("Outbox health query returned no row.");
  return {
    total: numberValue(row.total),
    pending: numberValue(row.pending),
    published: numberValue(row.published),
    failed: numberValue(row.failed),
    oldestPendingAgeSeconds:
      row.oldestPendingAgeSeconds === null ? null : numberValue(row.oldestPendingAgeSeconds),
  };
}

async function digest(
  queryable: Queryable,
  statement: string,
  capturedAt: string,
): Promise<ProtectedFactDigest> {
  const result = await queryable.query<{ count: number; digest: string } & QueryResultRow>(
    statement,
    [capturedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Protected fact digest query returned no row.");
  return { count: numberValue(row.count), digest: row.digest };
}

async function readFacts(queryable: Queryable, capturedAt: string): Promise<ProtectedFacts> {
  const votes = await digest(
    queryable,
    `select count(*)::int as "count",
        md5(coalesce(string_agg(
          concat_ws('|', vote_id::text, vote_attempt_id::text, issue_id::text, issue_version::text, choice_id::text, subject_id::text),
          ',' order by vote_id
        ), '')) as "digest"
      from votes where created_at <= $1::timestamptz`,
    capturedAt,
  );
  const outboxEvents = await digest(
    queryable,
    `select count(*)::int as "count",
        md5(coalesce(string_agg(
          concat_ws('|', event_id::text, aggregate_type, aggregate_id, event_type, schema_version::text, md5(payload::text)),
          ',' order by event_id
        ), '')) as "digest"
      from outbox_events where occurred_at <= $1::timestamptz`,
    capturedAt,
  );
  return { votes, outboxEvents };
}

export function createPostgresLaunchGateStore(pool: Pool): LaunchGateStore {
  return {
    readAppliedMigrationTimestamps: () => readMigrations(pool),
    readOutboxHealth: () => readOutbox(pool),
    async captureRollbackBaseline(): Promise<RollbackBaseline> {
      const client = await pool.connect();
      try {
        await client.query("begin isolation level repeatable read read only");
        const timeResult = await client.query<{ capturedAt: Date }>(
          'select transaction_timestamp() as "capturedAt"',
        );
        const capturedAt = timeResult.rows[0]?.capturedAt.toISOString();
        if (!capturedAt) throw new Error("Database time query returned no row.");
        const appliedMigrationTimestamps = await readMigrations(client);
        const outbox = await readOutbox(client);
        const protectedFacts = await readFacts(client, capturedAt);
        await client.query("commit");
        return { capturedAt, appliedMigrationTimestamps, outbox, protectedFacts };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    readProtectedFacts: (capturedAt) => readFacts(pool, capturedAt),
  };
}
