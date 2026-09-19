import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/client.js";
import { DEVELOPMENT_ISSUE, seedDevelopmentIssues } from "../src/database/development-seed.js";
import {
  issues,
  issueVersions,
  issueChoices,
  votes,
  comments,
} from "../src/database/schema/index.js";
import {
  radarTopics,
  radarEvents,
  radarEventTopics,
  radarEvidence,
  radarSources,
  radarObservations,
  radarObservationRevisions,
  radarEventObservations,
  radarIssueLinks,
} from "../src/database/schema/radar.js";
import { createRadarRepository } from "../src/modules/radar/repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const lifetime = { fetchedAt: "2026-09-19T10:00:00Z", expiresAt: "2026-09-20T10:00:00Z" };
function observation() {
  return {
    source: "GOOGLE_TRENDING_RSS",
    sourceItemId: randomUUID(),
    sourceUrl: "https://example.com/topic#fragment",
    title: "  로컬 관측  ",
    metricName: "search_traffic",
    scope: { countryCode: "KR", queryKey: "fixture", dimensionsKey: "all" },
    window: {
      start: "2026-09-19T09:00:00+09:00",
      end: "2026-09-19T10:00:00+09:00",
      granularity: "HOUR",
    },
    sampledAt: "2026-09-19T10:00:00+09:00",
    sourceUpdatedAt: null,
    metric: { kind: "COUNT", value: 0 },
  };
}
function bundle(observationIds: string[] = []) {
  const topicId = randomUUID();
  const eventId = randomUUID();
  return {
    topics: [{ id: topicId, name: "로컬 테스트 주제" }],
    event: {
      id: eventId,
      title: "로컬 사건",
      topicIds: [topicId],
      occurredAt: null,
      timePrecision: "UNKNOWN",
    },
    evidence: [
      {
        id: randomUUID(),
        eventId,
        source: "NAVER_SEARCH",
        sourceUrl: "https://example.com/article",
        claim: "합성 검증 근거",
        publishedAt: null,
        observedAt: lifetime.fetchedAt,
        expiresAt: lifetime.expiresAt,
        status: "UNKNOWN",
      },
    ],
    issueLinks: [{ eventId, issueId: DEVELOPMENT_ISSUE.id, issueVersion: 1 }],
    observationIds,
  };
}
async function coreSnapshot(db: Database) {
  return {
    issues: await db.db.select().from(issues).orderBy(issues.id),
    versions: await db.db
      .select()
      .from(issueVersions)
      .orderBy(issueVersions.issueId, issueVersions.version),
    choices: await db.db.select().from(issueChoices).orderBy(issueChoices.id),
    votes: await db.db.select().from(votes).orderBy(votes.id),
    comments: await db.db.select().from(comments).orderBy(comments.id),
  };
}

describe("Radar PostgreSQL storage", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let repo: ReturnType<typeof createRadarRepository>;
  let initial: Awaited<ReturnType<typeof coreSnapshot>>;
  beforeAll(async () => {
    const test = await createTestDatabase();
    db = test.database;
    cleanup = () => test.drop();
    repo = createRadarRepository(db);
    await seedDevelopmentIssues(db.db);
    initial = await coreSnapshot(db);
    expect(initial.votes.length).toBeGreaterThan(0);
  }, 30_000);
  afterAll(async () => {
    if (db) await db.close();
    if (cleanup) await cleanup();
  });

  it("installs the source catalog, time indexes and composite question-version FK", async () => {
    expect((await db.db.select().from(radarSources)).map((r) => r.code).sort()).toEqual([
      "GOOGLE_TRENDING_RSS",
      "NAVER_DATALAB",
      "NAVER_SEARCH",
      "YOUTUBE_DATA_API",
    ]);
    const indexes = await db.db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'radar_observations'`,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "radar_observations_key_unique",
        "radar_observations_source_sample_idx",
        "radar_observations_source_window_idx",
        "radar_observations_expiry_idx",
      ]),
    );
  });

  it("concurrently replays one observation without duplicates, preserving UTC windows/null/zero", async () => {
    const input = observation();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.saveObservation(input, lifetime)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const id = results[0]!.id;
    const row = await repo.findUnexpiredObservation(id, lifetime.fetchedAt);
    expect(row).toMatchObject({
      title: "로컬 관측",
      metricValue: 0,
      sourceUpdatedAt: null,
      sourceUrl: "https://example.com/topic",
    });
    expect(row?.windowStart.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(row?.windowEnd.toISOString()).toBe("2026-09-19T01:00:00.000Z");
    expect(row?.sampledAt.toISOString()).toBe("2026-09-19T01:00:00.000Z");
    expect(
      await db.db
        .select()
        .from(radarObservationRevisions)
        .where(eq(radarObservationRevisions.observationId, id)),
    ).toHaveLength(1);
  });

  it("keeps corrections and refuses stale retries without extending retention", async () => {
    const input = observation();
    const first = await repo.saveObservation(input, lifetime);
    const changed = { ...input, metric: { kind: "COUNT", value: 7 } };
    await expect(repo.saveObservation(changed, lifetime)).rejects.toThrow(
      "RADAR_CORRECTION_CONFLICT",
    );
    const later = { fetchedAt: "2026-09-19T11:00:00Z", expiresAt: "2026-09-20T11:00:00Z" };
    const corrected = await repo.saveObservation(changed, later, first.contentHash);
    expect(corrected.id).toBe(first.id);
    expect(corrected.contentHash).not.toBe(first.contentHash);
    await repo.saveObservation(changed, later);
    await expect(repo.saveObservation(input, lifetime)).rejects.toThrow(
      "RADAR_CORRECTION_CONFLICT",
    );
    const row = await repo.findUnexpiredObservation(first.id, lifetime.fetchedAt);
    expect(row?.metricValue).toBe(7);
    expect(row?.expiresAt.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    const revisions = await db.db
      .select()
      .from(radarObservationRevisions)
      .where(eq(radarObservationRevisions.observationId, first.id));
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.payload.metric.value).sort()).toEqual([0, 7]);
    expect(await repo.findUnexpiredObservation(first.id, lifetime.expiresAt)).toBeNull();
  });

  it("preserves unavailable metrics and exact large safe counts", async () => {
    for (const value of [null, Number.MAX_SAFE_INTEGER]) {
      const saved = await repo.saveObservation(
        { ...observation(), metric: { kind: "COUNT", value } },
        lifetime,
      );
      expect((await repo.findUnexpiredObservation(saved.id, lifetime.fetchedAt))?.metricValue).toBe(
        value,
      );
    }
  });

  it("serializes competing corrections with an expected content hash", async () => {
    const input = observation();
    const initial = await repo.saveObservation(input, lifetime);
    const results = await Promise.allSettled(
      [2, 3].map((value) =>
        repo.saveObservation(
          { ...input, metric: { kind: "COUNT", value } },
          lifetime,
          initial.contentHash,
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(radarObservationRevisions)
        .where(eq(radarObservationRevisions.observationId, initial.id)),
    ).toHaveLength(2);
  });

  it("does not return a row before its fetch time", async () => {
    const saved = await repo.saveObservation(observation(), lifetime);
    expect(await repo.findUnexpiredObservation(saved.id, "2026-09-19T09:59:59Z")).toBeNull();
  });

  it("enforces unknown vs known event-time consistency at database level", async () => {
    await expect(
      db.db.insert(radarEvents).values({
        id: randomUUID(),
        title: "invalid event",
        timePrecision: "EXACT",
        occurredAt: null,
      }),
    ).rejects.toThrow();
    await expect(
      db.db.insert(radarEvents).values({
        id: randomUUID(),
        title: "invalid event",
        timePrecision: "UNKNOWN",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("keeps independent samples and comparison cohorts separate", async () => {
    const input = observation();
    const a = await repo.saveObservation(input, lifetime);
    const b = await repo.saveObservation({ ...input, sampledAt: "2026-09-19T02:00:00Z" }, lifetime);
    const c = await repo.saveObservation(
      { ...input, metric: { kind: "RELATIVE_INDEX", value: 50.5, comparisonKey: "group-a" } },
      lifetime,
    );
    const d = await repo.saveObservation(
      { ...input, metric: { kind: "RELATIVE_INDEX", value: 50.5, comparisonKey: "group-b" } },
      lifetime,
    );
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
  });

  it("atomically saves event relations and replays without changing existing questions/votes", async () => {
    const obs = await repo.saveObservation(observation(), lifetime);
    const data = bundle([obs.id]);
    await repo.saveEventBundle(data);
    await repo.saveEventBundle(data);
    expect(
      await db.db
        .select()
        .from(radarEventTopics)
        .where(eq(radarEventTopics.eventId, data.event.id)),
    ).toHaveLength(1);
    expect(
      await db.db.select().from(radarEvidence).where(eq(radarEvidence.eventId, data.event.id)),
    ).toHaveLength(1);
    expect(
      await db.db.select().from(radarIssueLinks).where(eq(radarIssueLinks.eventId, data.event.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(radarEventObservations)
        .where(eq(radarEventObservations.eventId, data.event.id)),
    ).toHaveLength(1);
    expect(await coreSnapshot(db)).toEqual(initial);
  });

  it("rolls back the whole bundle when the exact question version does not exist", async () => {
    const data = bundle();
    data.issueLinks[0]!.issueVersion = 999;
    await expect(repo.saveEventBundle(data)).rejects.toThrow();
    expect(
      await db.db.select().from(radarEvents).where(eq(radarEvents.id, data.event.id)),
    ).toHaveLength(0);
    expect(
      await db.db.select().from(radarTopics).where(eq(radarTopics.id, data.topics[0]!.id)),
    ).toHaveLength(0);
    expect(
      await db.db.select().from(radarEvidence).where(eq(radarEvidence.eventId, data.event.id)),
    ).toHaveLength(0);
  });

  it("rolls back when an observation FK is missing", async () => {
    const data = bundle([randomUUID()]);
    await expect(repo.saveEventBundle(data)).rejects.toThrow();
    expect(
      await db.db.select().from(radarEvents).where(eq(radarEvents.id, data.event.id)),
    ).toHaveLength(0);
  });

  it("does not silently overwrite an existing identity or evidence", async () => {
    const data = bundle();
    await repo.saveEventBundle(data);
    await expect(
      repo.saveEventBundle({ ...data, event: { ...data.event, title: "다른 사건" } }),
    ).rejects.toThrow("RADAR_EVENT_CONFLICT");
    await expect(
      repo.saveEventBundle({ ...data, topics: [{ ...data.topics[0]!, name: "다른 주제" }] }),
    ).rejects.toThrow("RADAR_TOPIC_CONFLICT");
    await expect(
      repo.saveEventBundle({ ...data, evidence: [{ ...data.evidence[0]!, claim: "다른 근거" }] }),
    ).rejects.toThrow("RADAR_EVIDENCE_CONFLICT");
  });

  it("rejects invalid timestamps, empty topics, unregistered sources and unmatched bundle references", async () => {
    const data = bundle();
    await expect(
      repo.saveEventBundle({ ...data, event: { ...data.event, topicIds: [] } }),
    ).rejects.toThrow();
    await expect(
      repo.saveEventBundle({
        ...data,
        evidence: [{ ...data.evidence[0]!, eventId: randomUUID() }],
      }),
    ).rejects.toThrow();
    await expect(
      repo.saveObservation({ ...observation(), source: "UNKNOWN" }, lifetime),
    ).rejects.toThrow();
    await expect(
      repo.saveObservation(observation(), { ...lifetime, expiresAt: "2026-10-20T10:00:00Z" }),
    ).rejects.toThrow();
  });

  it.each([
    { metricKind: "COUNT", metricValue: -1 },
    { metricKind: "COUNT", metricValue: 0.5 },
    { metricKind: "COUNT", metricValue: NaN },
    { metricKind: "COUNT", metricValue: Infinity },
    { metricKind: "RANK", metricValue: 0, comparisonKey: "chart" },
    { metricKind: "RELATIVE_INDEX", metricValue: 101, comparisonKey: "group" },
    { metricKind: "RELATIVE_INDEX", metricValue: 50, comparisonKey: null },
    { granularity: "INVALID" },
    { source: "UNREGISTERED" },
    { countryCode: "kr" },
    { windowEnd: new Date("2020-01-01") },
    { sourceUrl: "https://user:pass@example.com/" },
  ])("enforces DB constraints against direct malformed writes %j", async (override) => {
    const saved = await repo.saveObservation(observation(), lifetime);
    await expect(
      db.db.update(radarObservations).set(override).where(eq(radarObservations.id, saved.id)),
    ).rejects.toThrow();
  });

  it("enforces source FK independently of the source allowlist", async () => {
    await db.db.delete(radarSources).where(eq(radarSources.code, "NAVER_DATALAB"));
    try {
      await expect(
        repo.saveObservation({ ...observation(), source: "NAVER_DATALAB" }, lifetime),
      ).rejects.toThrow();
    } finally {
      await db.db.insert(radarSources).values({ code: "NAVER_DATALAB" });
    }
  });

  it("deleting Radar data cascades only Radar links/history, not the questions/votes", async () => {
    const obs = await repo.saveObservation(observation(), lifetime);
    const data = bundle([obs.id]);
    await repo.saveEventBundle(data);
    await db.db.delete(radarObservations).where(eq(radarObservations.id, obs.id));
    expect(
      await db.db
        .select()
        .from(radarObservationRevisions)
        .where(eq(radarObservationRevisions.observationId, obs.id)),
    ).toHaveLength(0);
    expect(
      await db.db
        .select()
        .from(radarEventObservations)
        .where(eq(radarEventObservations.eventId, data.event.id)),
    ).toHaveLength(0);
    await db.db.delete(radarEvents).where(eq(radarEvents.id, data.event.id));
    expect(
      await db.db.select().from(radarIssueLinks).where(eq(radarIssueLinks.eventId, data.event.id)),
    ).toHaveLength(0);
    expect(await coreSnapshot(db)).toEqual(initial);
  });
});

describe("Radar upgrade migration", () => {
  it("upgrades a seeded pre-Radar database and safely reruns without data loss", async () => {
    const folder = await mkdtemp(join(tmpdir(), "which-radar-migration-"));
    let test: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as {
        version: string;
        dialect: string;
        entries: Array<{ idx: number; tag: string }>;
      };
      const expectedMigrationCount = journal.entries.length;
      journal.entries = journal.entries.filter((entry) => entry.idx < 67);
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(folder, `${entry.tag}.sql`),
        );
      test = await createTestDatabase({ migrationsFolder: folder });
      await seedDevelopmentIssues(test.database.db);
      const before = await coreSnapshot(test.database);
      expect(before.votes.length).toBeGreaterThan(0);
      await migrate(test.database.db, { migrationsFolder });
      expect(await coreSnapshot(test.database)).toEqual(before);
      const sourceCount = (await test.database.db.select().from(radarSources)).length;
      expect(sourceCount).toBe(4);
      await migrate(test.database.db, { migrationsFolder });
      expect(await coreSnapshot(test.database)).toEqual(before);
      expect(await test.database.db.select().from(radarSources)).toHaveLength(4);
      const applied = await test.database.db.execute(
        sql`select id from drizzle.__drizzle_migrations`,
      );
      expect(applied.rows).toHaveLength(expectedMigrationCount);
    } finally {
      if (test) {
        await test.database.close();
        await test.drop();
      }
      // Only the exact per-test mkdtemp folder is removed, never the migration source.
      await rm(folder, { recursive: true });
    }
  }, 30_000);
});
