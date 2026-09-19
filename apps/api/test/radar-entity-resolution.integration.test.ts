import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/database/client.js";
import {
  radarEvents,
  radarEventSourceReferences,
  radarResolutionActions,
  radarTopicAliases,
  radarTopics,
} from "../src/database/schema/radar.js";
import { createRadarEntityResolutionRepository } from "../src/modules/radar/entity-resolution-repository.js";
import { RADAR_ENTITY_RESOLVER_VERSION } from "../src/modules/radar/entity-resolution.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("Radar entity-resolution persistence", () => {
  let database: Database;
  let cleanup: () => Promise<void>;
  let repository: ReturnType<typeof createRadarEntityResolutionRepository>;

  beforeAll(async () => {
    const test = await createTestDatabase();
    database = test.database;
    cleanup = () => test.drop();
    repository = createRadarEntityResolutionRepository(database);
  }, 30_000);

  afterAll(async () => {
    if (database) await database.close();
    if (cleanup) await cleanup();
  });

  async function topics(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      name: `entity-resolution-topic-${index}`,
    }));
    await database.db.insert(radarTopics).values(rows);
    return rows.map((row) => row.id);
  }

  async function events(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      title: `entity-resolution-event-${index}`,
      occurredAt: null,
      timePrecision: "UNKNOWN",
    }));
    await database.db.insert(radarEvents).values(rows);
    return rows.map((row) => row.id);
  }

  function action(
    entityType: "TOPIC" | "EVENT",
    actionType: "MERGE" | "SPLIT" | "REVERT",
    subjectId: string,
    targetIds: string[],
    revertsActionId: string | null = null,
  ) {
    return {
      id: randomUUID(),
      entityType,
      action: actionType,
      subjectId,
      targetIds,
      revertsActionId,
      reason: `fixture ${actionType.toLowerCase()}`,
      actor: "radar-r08-integration-test",
      resolverVersion: RADAR_ENTITY_RESOLVER_VERSION,
    };
  }

  it("installs alias, source-reference and append-only action indexes", async () => {
    const rows = await database.db.execute<{ indexname: string }>(sql`
      select indexname
      from pg_indexes
      where tablename in (
        'radar_topic_aliases',
        'radar_event_source_references',
        'radar_resolution_actions'
      )
    `);
    expect(rows.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "radar_topic_aliases_key_unique",
        "radar_topic_aliases_lookup_idx",
        "radar_event_source_item_unique",
        "radar_event_source_references_lookup_idx",
        "radar_resolution_actions_sequence_unique",
        "radar_resolution_actions_subject_idx",
      ]),
    );
  });

  it("persists one current alias state across equivalent time offsets", async () => {
    const [topicId] = await topics(1);
    const first = await repository.saveTopicAlias({
      id: randomUUID(),
      topicId,
      alias: "  Ａｐｐｌｅ   Inc. ",
      languageCode: "en-us",
      source: "NAVER_SEARCH",
      validFrom: "2026-09-20T09:00:00+09:00",
      validUntil: "2026-09-21T09:00:00+09:00",
      status: "VERIFIED",
    });
    const replay = await repository.saveTopicAlias({
      id: randomUUID(),
      topicId,
      alias: "  Ａｐｐｌｅ   Inc. ",
      languageCode: "en-US",
      source: "NAVER_SEARCH",
      validFrom: "2026-09-20T00:00:00Z",
      validUntil: "2026-09-21T00:00:00Z",
      status: "VERIFIED",
    });

    expect(replay).toEqual(first);
    const rejected = await repository.saveTopicAlias({
      id: randomUUID(),
      topicId,
      alias: "  Ａｐｐｌｅ   Inc. ",
      languageCode: "en-US",
      source: "NAVER_SEARCH",
      validFrom: "2026-09-20T00:00:00Z",
      validUntil: "2026-09-21T00:00:00Z",
      status: "REJECTED",
    });
    expect(rejected).toEqual(first);
    const saved = await database.db
      .select()
      .from(radarTopicAliases)
      .where(eq(radarTopicAliases.topicId, topicId!));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      alias: "Ａｐｐｌｅ Inc.",
      normalizedAlias: "apple inc.",
      languageCode: "en-US",
      source: "NAVER_SEARCH",
      status: "REJECTED",
    });
  });

  it("keeps a provider item bound to one event and accepts an exact replay", async () => {
    const [eventId, otherEventId] = await events(2);
    const input = {
      id: randomUUID(),
      eventId,
      source: "YOUTUBE_DATA_API" as const,
      sourceItemId: "community-post-42",
      title: "  신제품   공개  ",
      languageCode: "ko-kr",
      observedAt: "2026-09-20T09:00:00+09:00",
    };
    const first = await repository.saveEventSourceReference(input);
    const replay = await repository.saveEventSourceReference({
      ...input,
      id: randomUUID(),
      languageCode: "ko-KR",
      observedAt: "2026-09-20T00:00:00Z",
    });
    expect(replay).toEqual(first);
    expect(
      await database.db
        .select()
        .from(radarEventSourceReferences)
        .where(eq(radarEventSourceReferences.eventId, eventId!)),
    ).toHaveLength(1);
    await expect(
      repository.saveEventSourceReference({ ...input, id: randomUUID(), eventId: otherEventId }),
    ).rejects.toThrow("RADAR_EVENT_REFERENCE_CONFLICT");
  });

  it("reverts an incorrect merge without deleting its audit trail", async () => {
    const [subjectId, targetId] = await topics(2);
    const merge = action("TOPIC", "MERGE", subjectId!, [targetId!]);
    expect(await repository.recordResolutionAction(merge)).toMatchObject({
      actionId: merge.id,
      state: { status: "MERGED", targetId },
    });

    const revert = action("TOPIC", "REVERT", subjectId!, [], merge.id);
    expect(await repository.recordResolutionAction(revert)).toEqual({
      actionId: revert.id,
      state: { status: "ACTIVE", actionId: null },
    });
    expect(await repository.readResolutionHistory("TOPIC", subjectId!)).toMatchObject([
      { id: merge.id, action: "MERGE", targetIds: [targetId] },
      { id: revert.id, action: "REVERT", revertsActionId: merge.id },
    ]);
  });

  it("records split lineage while keeping every prior decision", async () => {
    const [subjectId, leftId, rightId] = await topics(3);
    const split = action("TOPIC", "SPLIT", subjectId!, [rightId!, leftId!]);
    const saved = await repository.recordResolutionAction(split);
    expect(saved.state).toEqual({
      status: "SPLIT",
      actionId: split.id,
      targetIds: [leftId!, rightId!].sort(),
    });
    expect(await repository.readResolutionHistory("TOPIC", subjectId!)).toHaveLength(1);
  });

  it("serializes competing decisions for the same subject", async () => {
    const [subjectId, firstTarget, secondTarget] = await events(3);
    const results = await Promise.allSettled([
      repository.recordResolutionAction(action("EVENT", "MERGE", subjectId!, [firstTarget!])),
      repository.recordResolutionAction(action("EVENT", "MERGE", subjectId!, [secondTarget!])),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await repository.readResolutionHistory("EVENT", subjectId!)).toHaveLength(1);
    await expect(
      repository.recordResolutionAction(
        action("EVENT", "SPLIT", subjectId!, [firstTarget!, secondTarget!]),
      ),
    ).rejects.toThrow("RADAR_RESOLUTION_SUBJECT_RETIRED");
  });

  it("rejects missing identities and malformed direct writes", async () => {
    const [targetId] = await topics(1);
    await expect(
      repository.recordResolutionAction(action("TOPIC", "MERGE", randomUUID(), [targetId!])),
    ).rejects.toThrow("RADAR_RESOLUTION_ENTITY_MISSING");

    await expect(
      database.db.insert(radarResolutionActions).values({
        id: randomUUID(),
        entityType: "TOPIC",
        action: "MERGE",
        subjectId: targetId!,
        targetIds: [],
        revertsActionId: null,
        reason: "invalid empty merge",
        actor: "direct-write-test",
        resolverVersion: RADAR_ENTITY_RESOLVER_VERSION,
      }),
    ).rejects.toThrow();
  });
});
