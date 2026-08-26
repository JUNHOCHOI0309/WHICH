import { randomUUID } from "node:crypto";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { members, pointAccounts, pointLedgerEntries } from "../src/database/schema/index.js";
import { createMemberPointService } from "../src/modules/points/member-service.js";
import { operationDayAt } from "../src/modules/points/policy.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("Member W Point read model", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  it("returns only the requested Member ledger with stable cursor pagination", async () => {
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    await testDatabase.database.db.insert(members).values([
      { id: memberId, displayName: "Point owner" },
      { id: otherMemberId, displayName: "Other member" },
    ]);
    await testDatabase.database.db.insert(pointAccounts).values([
      { memberId, cachedBalance: 20, lifetimeEarned: 30, lifetimeSpent: 10 },
      { memberId: otherMemberId, cachedBalance: 999, lifetimeEarned: 999 },
    ]);
    const operationDay = operationDayAt(new Date());
    await testDatabase.database.db.insert(pointLedgerEntries).values([
      {
        memberId,
        entryType: "EARN",
        amount: 10,
        reasonCode: "VOTE_ACCEPTED",
        sourceType: "VOTE",
        sourceId: randomUUID(),
        operationDay,
        idempotencyKey: randomUUID(),
        policyVersion: "test",
        createdAt: new Date("2026-08-26T02:00:00.000Z"),
      },
      {
        memberId,
        entryType: "EARN",
        amount: 20,
        reasonCode: "VERIFIED_SHARE",
        sourceType: "SHARE",
        sourceId: randomUUID(),
        operationDay,
        idempotencyKey: randomUUID(),
        policyVersion: "test",
        createdAt: new Date("2026-08-26T01:00:00.000Z"),
      },
      {
        memberId: otherMemberId,
        entryType: "EARN",
        amount: 999,
        reasonCode: "OPERATOR_ADJUSTMENT",
        sourceType: "OPERATOR",
        sourceId: randomUUID(),
        operationDay,
        idempotencyKey: randomUUID(),
        policyVersion: "test",
        createdAt: new Date("2026-08-26T03:00:00.000Z"),
      },
    ]);
    const service = createMemberPointService(testDatabase.database.db);

    const first = await service.getMemberPoints(memberId, { limit: 1 });
    expect(first.account).toMatchObject({
      balance: 20,
      todayEarned: 30,
      lifetimeEarned: 30,
      lifetimeSpent: 10,
    });
    expect(first.ledger.items).toEqual([
      expect.objectContaining({ amount: 10, reasonLabel: "투표 참여" }),
    ]);
    expect(first.ledger.nextCursor).toEqual(expect.any(String));

    const decoded = JSON.parse(
      Buffer.from(first.ledger.nextCursor!, "base64url").toString("utf8"),
    ) as { createdAt: string; entryId: string };
    const second = await service.getMemberPoints(memberId, {
      limit: 1,
      cursor: { createdAt: new Date(decoded.createdAt), entryId: decoded.entryId },
    });
    expect(second.ledger.items).toEqual([
      expect.objectContaining({ amount: 20, reasonLabel: "결과 공유" }),
    ]);
    expect(second.ledger.nextCursor).toBeNull();
  });

  it("returns a safe empty state when the Member has no point account", async () => {
    const memberId = randomUUID();
    await testDatabase.database.db.insert(members).values({ id: memberId, displayName: "Empty" });
    const service = createMemberPointService(testDatabase.database.db);

    await expect(service.getMemberPoints(memberId, { limit: 5 })).resolves.toEqual({
      account: {
        balance: 0,
        todayEarned: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        hasPendingRecovery: false,
      },
      ledger: { items: [], nextCursor: null },
    });
  });
});
