import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  members,
  memberPointBadgeAwards,
  outboxEvents,
  pointAccounts,
  pointDailyCounters,
  pointLedgerEntries,
} from "../src/database/schema/index.js";
import { createPointLedgerService } from "../src/modules/points/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("point ledger foundation", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function createMember(status: "ACTIVE" | "LIMITED" | "SUSPENDED" = "ACTIVE") {
    const memberId = randomUUID();
    await testDatabase.database.db.insert(members).values({
      id: memberId,
      status,
      displayName: `Point Member ${memberId.slice(0, 6)}`,
    });
    return memberId;
  }

  function earnCommand(memberId: string, sourceId = randomUUID()) {
    return {
      memberId,
      entryType: "EARN" as const,
      amount: 10,
      reasonCode: "VOTE_ACCEPTED",
      sourceType: "VOTE",
      sourceId,
      operationDay: "2026-08-26",
      idempotencyKey: `vote:${sourceId}:points:v1`,
      policyVersion: "w_point_v1",
      counterKey: "ACCEPTED_VOTE",
    };
  }

  it("creates an account, immutable ledger fact, and daily counter atomically", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);

    const result = await service.applyEntry(earnCommand(memberId));

    expect(result).toMatchObject({
      applied: true,
      account: { cachedBalance: 10, lifetimeEarned: 10, lifetimeSpent: 0, version: 1 },
    });
    const [counter] = await testDatabase.database.db
      .select()
      .from(pointDailyCounters)
      .where(eq(pointDailyCounters.memberId, memberId));
    expect(counter).toMatchObject({
      operationDay: "2026-08-26",
      counterKey: "ACCEPTED_VOTE",
      qualifyingCount: 1,
      awardedPoints: 10,
    });
    const awards = await testDatabase.database.db
      .select()
      .from(memberPointBadgeAwards)
      .where(eq(memberPointBadgeAwards.memberId, memberId));
    expect(awards).toEqual([
      expect.objectContaining({
        badgeCode: "BRONZE",
        policyVersion: "w_badge_v1",
        thresholdSnapshot: 10,
        awardSource: "LEDGER_ENTRY",
        sourceLedgerEntryId: result.entryId,
      }),
    ]);
    const badgeEvents = await testDatabase.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, awards[0]!.id));
    expect(badgeEvents).toEqual([
      expect.objectContaining({ eventType: "POINT_BADGE_AWARDED", status: "PENDING" }),
    ]);
  });

  it("returns a no-op when the same idempotency key is replayed", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const command = earnCommand(memberId);

    const first = await service.applyEntry(command);
    const replay = await service.applyEntry(command);

    expect(first.applied).toBe(true);
    expect(replay).toMatchObject({ applied: false, entryId: first.entryId });
    const entries = await testDatabase.database.db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    expect(entries).toHaveLength(1);
    const awards = await testDatabase.database.db
      .select({ id: memberPointBadgeAwards.id })
      .from(memberPointBadgeAwards)
      .where(eq(memberPointBadgeAwards.memberId, memberId));
    expect(awards).toHaveLength(1);
    expect(replay.account).toMatchObject({ cachedBalance: 10, lifetimeEarned: 10, version: 1 });
  });

  it("treats the same source fact as a no-op even with a different transport key", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const command = earnCommand(memberId);
    await service.applyEntry(command);

    const replay = await service.applyEntry({
      ...command,
      idempotencyKey: `retry:${randomUUID()}`,
    });

    expect(replay.applied).toBe(false);
    expect(replay.account.cachedBalance).toBe(10);
  });

  it("rejects a reused key that describes a different point fact", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const command = earnCommand(memberId);
    await service.applyEntry(command);

    await expect(
      service.applyEntry({
        ...command,
        sourceId: randomUUID(),
        amount: 20,
      }),
    ).rejects.toMatchObject({ code: "POINT_IDEMPOTENCY_CONFLICT" });
  });

  it("serializes concurrent awards without losing balance or counter increments", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const commands = Array.from({ length: 12 }, () => earnCommand(memberId));

    const results = await Promise.all(commands.map((command) => service.applyEntry(command)));

    expect(results.every((result) => result.applied)).toBe(true);
    const [account] = await testDatabase.database.db
      .select()
      .from(pointAccounts)
      .where(eq(pointAccounts.memberId, memberId));
    expect(account).toMatchObject({
      cachedBalance: 120,
      lifetimeEarned: 120,
      lifetimeSpent: 0,
      version: 12,
    });
    const [counter] = await testDatabase.database.db
      .select()
      .from(pointDailyCounters)
      .where(eq(pointDailyCounters.memberId, memberId));
    expect(counter).toMatchObject({ qualifyingCount: 12, awardedPoints: 120 });
  });

  it("awards every crossed badge exactly once from versioned policy data", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const first = earnCommand(memberId);
    await service.applyEntry({ ...first, amount: 5_000 });

    const awards = await testDatabase.database.db
      .select({ badgeCode: memberPointBadgeAwards.badgeCode })
      .from(memberPointBadgeAwards)
      .where(eq(memberPointBadgeAwards.memberId, memberId));
    expect(awards.map((award) => award.badgeCode).sort()).toEqual(["BRONZE", "GOLD", "SILVER"]);

    await service.applyEntry(earnCommand(memberId));
    const replayedAwards = await testDatabase.database.db
      .select({ badgeCode: memberPointBadgeAwards.badgeCode })
      .from(memberPointBadgeAwards)
      .where(eq(memberPointBadgeAwards.memberId, memberId));
    expect(replayedAwards).toHaveLength(3);
  });

  it("enforces a concurrent daily award cap inside the ledger transaction", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const commands = Array.from({ length: 12 }, () => ({
      ...earnCommand(memberId),
      dailyQualifyingLimit: 10,
      dailyPointLimit: 100,
    }));

    const results = await Promise.allSettled(
      commands.map((command) => service.applyEntry(command)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code === "POINT_DAILY_LIMIT_REACHED",
      ),
    ).toHaveLength(2);
    const [account] = await testDatabase.database.db
      .select()
      .from(pointAccounts)
      .where(eq(pointAccounts.memberId, memberId));
    expect(account).toMatchObject({ cachedBalance: 100, lifetimeEarned: 100, version: 10 });
  });

  it("rolls back a spend that would make the balance negative", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const sourceId = randomUUID();

    await expect(
      service.applyEntry({
        memberId,
        entryType: "SPEND",
        amount: -10,
        reasonCode: "CATALOG_PURCHASE",
        sourceType: "POINT_PURCHASE",
        sourceId,
        operationDay: "2026-08-26",
        idempotencyKey: `purchase:${sourceId}:points:v1`,
        policyVersion: "w_point_v1",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_POINT_BALANCE" });

    const accounts = await testDatabase.database.db
      .select()
      .from(pointAccounts)
      .where(eq(pointAccounts.memberId, memberId));
    const entries = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.memberId, memberId));
    expect(accounts).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it("tracks spend separately while preserving lifetime earned", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    await service.applyEntry(earnCommand(memberId));
    const sourceId = randomUUID();

    const spent = await service.applyEntry({
      memberId,
      entryType: "SPEND",
      amount: -10,
      reasonCode: "CATALOG_PURCHASE",
      sourceType: "POINT_PURCHASE",
      sourceId,
      operationDay: "2026-08-26",
      idempotencyKey: `purchase:${sourceId}:points:v1`,
      policyVersion: "w_point_v1",
    });

    expect(spent.account).toMatchObject({
      cachedBalance: 0,
      lifetimeEarned: 10,
      lifetimeSpent: 10,
      version: 2,
    });
    const awards = await testDatabase.database.db
      .select({ badgeCode: memberPointBadgeAwards.badgeCode })
      .from(memberPointBadgeAwards)
      .where(eq(memberPointBadgeAwards.memberId, memberId));
    expect(awards).toEqual([{ badgeCode: "BRONZE" }]);
  });

  it("blocks update and delete mutations at the database boundary", async () => {
    const memberId = await createMember();
    const service = createPointLedgerService(testDatabase.database.db);
    const created = await service.applyEntry(earnCommand(memberId));

    await expect(
      testDatabase.database.db.execute(
        sql`update point_ledger_entries set amount = 20 where point_ledger_entry_id = ${created.entryId}`,
      ),
    ).rejects.toHaveProperty("cause.message", "point ledger entries are immutable");
    await expect(
      testDatabase.database.db.execute(
        sql`delete from point_ledger_entries where point_ledger_entry_id = ${created.entryId}`,
      ),
    ).rejects.toHaveProperty("cause.message", "point ledger entries are immutable");
  });

  it("does not create point accounts for inactive members", async () => {
    const memberId = await createMember("SUSPENDED");
    const service = createPointLedgerService(testDatabase.database.db);

    await expect(service.applyEntry(earnCommand(memberId))).rejects.toMatchObject({
      code: "MEMBER_NOT_ELIGIBLE",
    });
  });
});
