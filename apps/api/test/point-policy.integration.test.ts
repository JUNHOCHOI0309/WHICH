import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  memberDailyAttendances,
  memberProfiles,
  members,
  outboxEvents,
  pointAccounts,
  pointEventReceipts,
  pointLedgerEntries,
} from "../src/database/schema/index.js";
import { createPointPolicyConsumer, POINT_POLICY_VERSION } from "../src/modules/points/policy.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("W Point policy Outbox consumer", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function member() {
    const id = randomUUID();
    await testDatabase.database.db.insert(members).values({ id, displayName: `Point ${id}` });
    return id;
  }

  async function event(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    occurredAt: Date;
    data: Record<string, unknown>;
  }) {
    const id = randomUUID();
    await testDatabase.database.db.insert(outboxEvents).values({
      id,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      schemaVersion: 1,
      occurredAt: input.occurredAt,
      payload: { data: input.data },
    });
    const [row] = await testDatabase.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id));
    return row!;
  }

  it("awards daily attendance using the occurrence day in Asia/Seoul", async () => {
    const memberId = await member();
    const occurredAt = new Date("2026-08-25T15:30:00.000Z");
    const [fact] = await testDatabase.database.db
      .insert(memberDailyAttendances)
      .values({ memberId, operationDay: "2026-08-26", occurredAt })
      .returning();
    const outbox = await event({
      eventType: "MEMBER_DAILY_ATTENDANCE_CONFIRMED",
      aggregateType: "MEMBER_ATTENDANCE",
      aggregateId: fact!.id,
      occurredAt,
      data: { fact_id: fact!.id, member_id: memberId },
    });
    const consumer = createPointPolicyConsumer(testDatabase.database.db, { enabled: true });

    expect(await consumer.processEvent(outbox)).toBe("AWARDED");
    const [entry] = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    expect(entry).toMatchObject({
      amount: 10,
      reasonCode: "DAILY_LOGIN",
      operationDay: "2026-08-26",
      policyVersion: POINT_POLICY_VERSION,
    });
  });

  it("reprocessing the same Event ID is an idempotent no-op", async () => {
    const memberId = await member();
    const occurredAt = new Date("2026-08-26T03:00:00.000Z");
    const [fact] = await testDatabase.database.db
      .insert(memberDailyAttendances)
      .values({ memberId, operationDay: "2026-08-26", occurredAt })
      .returning();
    const outbox = await event({
      eventType: "MEMBER_DAILY_ATTENDANCE_CONFIRMED",
      aggregateType: "MEMBER_ATTENDANCE",
      aggregateId: fact!.id,
      occurredAt,
      data: { fact_id: fact!.id, member_id: memberId },
    });
    const consumer = createPointPolicyConsumer(testDatabase.database.db, { enabled: true });

    await consumer.processEvent(outbox);
    await consumer.processEvent(outbox);
    const entries = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    const receipts = await testDatabase.database.db
      .select()
      .from(pointEventReceipts)
      .where(eq(pointEventReceipts.eventId, outbox.id));
    expect(entries).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });

  it("awards the public profile completion bonus once per account", async () => {
    const memberId = await member();
    await testDatabase.database.db.insert(memberProfiles).values({
      memberId,
      handle: `p_${memberId.replaceAll("-", "").slice(0, 10)}`,
      bio: "완성된 공개 프로필",
      visibility: "PUBLIC",
    });
    const occurredAt = new Date("2026-08-26T04:00:00.000Z");
    const events = await Promise.all(
      [0, 1].map(() =>
        event({
          eventType: "MEMBER_PUBLIC_PROFILE_COMPLETED",
          aggregateType: "MEMBER",
          aggregateId: memberId,
          occurredAt,
          data: { fact_id: memberId, member_id: memberId },
        }),
      ),
    );
    const consumer = createPointPolicyConsumer(testDatabase.database.db, { enabled: true });

    expect(await consumer.processEvent(events[0]!)).toBe("AWARDED");
    expect(await consumer.processEvent(events[1]!)).toBe("DUPLICATE");
    const [account] = await testDatabase.database.db
      .select()
      .from(pointAccounts)
      .where(eq(pointAccounts.memberId, memberId));
    expect(account).toMatchObject({ cachedBalance: 50, lifetimeEarned: 50, version: 1 });
  });

  it("records disabled events without awarding and ignores analytics Events", async () => {
    const memberId = await member();
    const occurredAt = new Date("2026-08-26T05:00:00.000Z");
    const [fact] = await testDatabase.database.db
      .insert(memberDailyAttendances)
      .values({ memberId, operationDay: "2026-08-26", occurredAt })
      .returning();
    const rewardEvent = await event({
      eventType: "MEMBER_DAILY_ATTENDANCE_CONFIRMED",
      aggregateType: "MEMBER_ATTENDANCE",
      aggregateId: fact!.id,
      occurredAt,
      data: { fact_id: fact!.id, member_id: memberId },
    });
    await event({
      eventType: "SHARE_COMPLETE",
      aggregateType: "ANALYTICS",
      aggregateId: randomUUID(),
      occurredAt,
      data: { member_id: memberId },
    });
    const disabled = createPointPolicyConsumer(testDatabase.database.db, { enabled: false });

    expect(await disabled.processEvent(rewardEvent)).toBe("DISABLED");
    expect(await disabled.processBatch()).toMatchObject({ claimed: 0 });
    const entries = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    expect(entries).toHaveLength(0);
  });
});
