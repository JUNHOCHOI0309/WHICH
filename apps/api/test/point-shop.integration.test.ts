import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  memberEquipment,
  memberInventory,
  members,
  pointCatalogItems,
  pointLedgerEntries,
  pointPurchases,
} from "../src/database/schema/index.js";
import { createPointShopService } from "../src/modules/point-shop/service.js";
import { createPointLedgerService } from "../src/modules/points/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

describe("W Point shop foundation", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.database.close();
    await testDatabase.drop();
  });

  async function createMemberWithPoints(amount: number) {
    const memberId = randomUUID();
    await testDatabase.database.db.insert(members).values({
      id: memberId,
      displayName: `Shop Member ${memberId.slice(0, 6)}`,
    });
    if (amount > 0) {
      await createPointLedgerService(testDatabase.database.db).applyEntry({
        memberId,
        entryType: "EARN",
        amount,
        reasonCode: "TEST_SHOP_BALANCE",
        sourceType: "TEST",
        sourceId: randomUUID(),
        operationDay: "2026-08-28",
        idempotencyKey: `test-shop-balance:${memberId}`,
        policyVersion: "POINT_SHOP_TEST",
        counterKey: "TEST_SHOP_BALANCE",
      });
    }
    return memberId;
  }

  async function itemByCode(code: string) {
    const [item] = await testDatabase.database.db
      .select()
      .from(pointCatalogItems)
      .where(eq(pointCatalogItems.code, code))
      .limit(1);
    return item!;
  }

  it("lists the initial twelve cosmetic SKUs with versioned manifests", async () => {
    const memberId = await createMemberWithPoints(0);
    const view = await createPointShopService(testDatabase.database.db).listShop(memberId);

    expect(view.catalog).toHaveLength(12);
    expect(new Set(view.catalog.map((item) => item.themeFamily))).toEqual(
      new Set(["SIGNAL_GRID", "PAPER_VOTE", "NEON_RIFT", "SOFT_ORBIT"]),
    );
    expect(view.catalog[0]?.assetManifest).toMatchObject({
      schemaVersion: 1,
      choiceA: "#15C4D6",
      choiceB: "#FF7A1A",
    });
  });

  it("spends, creates a purchase, and grants inventory in one transaction", async () => {
    const memberId = await createMemberWithPoints(2_000);
    const item = await itemByCode("SIGNAL_GRID_AVATAR_FRAME");
    const service = createPointShopService(testDatabase.database.db);
    const idempotencyKey = randomUUID();

    const purchased = await service.purchase({ memberId, itemId: item.id, idempotencyKey });
    const replay = await service.purchase({ memberId, itemId: item.id, idempotencyKey });

    expect(purchased).toMatchObject({ price: 1_400, balance: 600, idempotent: false });
    expect(replay).toMatchObject({
      purchaseId: purchased.purchaseId,
      idempotent: true,
      balance: 600,
    });
    const purchases = await testDatabase.database.db
      .select()
      .from(pointPurchases)
      .where(eq(pointPurchases.memberId, memberId));
    const inventory = await testDatabase.database.db
      .select()
      .from(memberInventory)
      .where(eq(memberInventory.memberId, memberId));
    const spends = await testDatabase.database.db
      .select()
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.memberId, memberId),
          eq(pointLedgerEntries.reasonCode, "POINT_ITEM_PURCHASE"),
        ),
      );
    expect(purchases).toHaveLength(1);
    expect(inventory).toEqual([expect.objectContaining({ itemId: item.id, state: "OWNED" })]);
    expect(spends).toHaveLength(1);
  });

  it("allows different members to purchase the same catalog item", async () => {
    const firstMemberId = await createMemberWithPoints(2_000);
    const secondMemberId = await createMemberWithPoints(2_000);
    const item = await itemByCode("SOFT_ORBIT_ACCENT");
    const service = createPointShopService(testDatabase.database.db);

    const first = await service.purchase({
      memberId: firstMemberId,
      itemId: item.id,
      idempotencyKey: randomUUID(),
    });
    const second = await service.purchase({
      memberId: secondMemberId,
      itemId: item.id,
      idempotencyKey: randomUUID(),
    });

    expect(first.purchaseId).not.toBe(second.purchaseId);
    expect(first.itemId).toBe(item.id);
    expect(second.itemId).toBe(item.id);
  });

  it("rejects insufficient balance without leaving a purchase or inventory row", async () => {
    const memberId = await createMemberWithPoints(10);
    const item = await itemByCode("NEON_RIFT_SHARE_CARD");
    const service = createPointShopService(testDatabase.database.db);

    await expect(
      service.purchase({ memberId, itemId: item.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "SHOP_INSUFFICIENT_BALANCE" });
    expect(
      await testDatabase.database.db
        .select()
        .from(pointPurchases)
        .where(eq(pointPurchases.memberId, memberId)),
    ).toHaveLength(0);
    expect(
      await testDatabase.database.db
        .select()
        .from(memberInventory)
        .where(eq(memberInventory.memberId, memberId)),
    ).toHaveLength(0);
  });

  it("equips and unequips an owned item without revoking inventory", async () => {
    const memberId = await createMemberWithPoints(2_000);
    const item = await itemByCode("PAPER_VOTE_ACCENT");
    const service = createPointShopService(testDatabase.database.db);
    await service.purchase({
      memberId,
      itemId: item.id,
      idempotencyKey: randomUUID(),
    });

    await service.equip({ memberId, itemId: item.id, equipSlot: "PROFILE_ACCENT" });
    await service.unequip({ memberId, equipSlot: "PROFILE_ACCENT" });

    expect(
      await testDatabase.database.db
        .select()
        .from(memberEquipment)
        .where(eq(memberEquipment.memberId, memberId)),
    ).toHaveLength(0);
    const [inventory] = await testDatabase.database.db
      .select()
      .from(memberInventory)
      .where(eq(memberInventory.memberId, memberId));
    expect(inventory).toMatchObject({ state: "OWNED" });
  });
});
