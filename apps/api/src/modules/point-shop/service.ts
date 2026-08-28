import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  memberEquipment,
  memberInventory,
  outboxEvents,
  pointAccounts,
  pointCatalogItems,
  pointCatalogItemVersions,
  pointPurchases,
} from "../../database/schema/index.js";
import { operationDayAt } from "../points/policy.js";
import { createPointLedgerService, PointLedgerError } from "../points/service.js";
import type {
  MemberPointShopView,
  PointShopCatalogItem,
  PointShopEquipSlot,
  PointShopEquipmentResult,
  PointShopPurchaseResult,
  PointShopService,
} from "./contracts.js";

export type PointShopErrorCode =
  | "SHOP_ITEM_NOT_FOUND"
  | "SHOP_ITEM_NOT_FOR_SALE"
  | "SHOP_ITEM_ALREADY_OWNED"
  | "SHOP_INSUFFICIENT_BALANCE"
  | "SHOP_IDEMPOTENCY_CONFLICT"
  | "SHOP_INVENTORY_NOT_OWNED"
  | "SHOP_SLOT_MISMATCH"
  | "SHOP_PURCHASE_NOT_REFUNDABLE";

export class PointShopError extends Error {
  constructor(
    public readonly code: PointShopErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PointShopError";
  }
}

const slots = ["PROFILE_ACCENT", "AVATAR_FRAME", "SHARE_BACKGROUND"] as const;

export function isPointShopEquipSlot(value: string): value is PointShopEquipSlot {
  return slots.includes(value as PointShopEquipSlot);
}

function internalIdempotencyKey(memberId: string, key: string) {
  return `point-shop:${memberId}:${key}`;
}

function mapLedgerError(error: unknown): never {
  if (error instanceof PointLedgerError) {
    if (error.code === "INSUFFICIENT_POINT_BALANCE") {
      throw new PointShopError("SHOP_INSUFFICIENT_BALANCE", "W Point 잔액이 부족합니다.");
    }
    if (error.code === "POINT_IDEMPOTENCY_CONFLICT") {
      throw new PointShopError(
        "SHOP_IDEMPOTENCY_CONFLICT",
        "같은 요청 키가 다른 구매에 이미 사용되었습니다.",
      );
    }
  }
  throw error;
}

export function createPointShopService(database: Database["db"]): PointShopService {
  const ledger = createPointLedgerService(database);

  async function listShop(memberId: string): Promise<MemberPointShopView> {
    const now = new Date();
    const [catalogRows, inventoryRows, equipmentRows, accountRows] = await Promise.all([
      database
        .select({
          id: pointCatalogItems.id,
          code: pointCatalogItems.code,
          itemType: pointCatalogItems.itemType,
          surface: pointCatalogItems.surface,
          equipSlot: pointCatalogItems.equipSlot,
          themeFamily: pointCatalogItems.themeFamily,
          name: pointCatalogItems.name,
          description: pointCatalogItems.description,
          price: pointCatalogItems.price,
          permanent: pointCatalogItems.permanent,
          currentVersion: pointCatalogItems.currentVersion,
          assetManifest: pointCatalogItemVersions.assetManifest,
          previewAssets: pointCatalogItemVersions.previewAssets,
          accessibilityMetadata: pointCatalogItemVersions.accessibilityMetadata,
        })
        .from(pointCatalogItems)
        .innerJoin(
          pointCatalogItemVersions,
          and(
            eq(pointCatalogItemVersions.itemId, pointCatalogItems.id),
            eq(pointCatalogItemVersions.version, pointCatalogItems.currentVersion),
          ),
        )
        .where(
          and(
            eq(pointCatalogItems.status, "ACTIVE"),
            or(isNull(pointCatalogItems.saleStartAt), lte(pointCatalogItems.saleStartAt, now)),
            or(isNull(pointCatalogItems.saleEndAt), gt(pointCatalogItems.saleEndAt, now)),
          ),
        )
        .orderBy(asc(pointCatalogItems.themeFamily), asc(pointCatalogItems.price)),
      database
        .select({ itemId: memberInventory.itemId })
        .from(memberInventory)
        .where(and(eq(memberInventory.memberId, memberId), eq(memberInventory.state, "OWNED"))),
      database
        .select({ equipSlot: memberEquipment.equipSlot, itemId: memberEquipment.itemId })
        .from(memberEquipment)
        .where(eq(memberEquipment.memberId, memberId)),
      database
        .select({ balance: pointAccounts.cachedBalance })
        .from(pointAccounts)
        .where(eq(pointAccounts.memberId, memberId))
        .limit(1),
    ]);

    const ownedIds = new Set(inventoryRows.map((row) => row.itemId));
    const equippedIds = new Set(equipmentRows.map((row) => row.itemId));
    const equipment: MemberPointShopView["equipment"] = {};
    for (const row of equipmentRows) {
      if (isPointShopEquipSlot(row.equipSlot)) equipment[row.equipSlot] = row.itemId;
    }

    const catalog = catalogRows.flatMap((row): PointShopCatalogItem[] => {
      if (!isPointShopEquipSlot(row.equipSlot)) return [];
      return [
        {
          ...row,
          assetManifest: row.assetManifest ?? {},
          previewAssets: row.previewAssets ?? {},
          accessibilityMetadata: row.accessibilityMetadata ?? {},
          equipSlot: row.equipSlot,
          owned: ownedIds.has(row.id),
          equipped: equippedIds.has(row.id),
        },
      ];
    });

    return { balance: accountRows[0]?.balance ?? 0, catalog, equipment };
  }

  async function purchase(input: {
    memberId: string;
    itemId: string;
    idempotencyKey: string;
  }): Promise<PointShopPurchaseResult> {
    const key = internalIdempotencyKey(input.memberId, input.idempotencyKey);
    try {
      return await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.memberId}:point-shop`}, 0))`,
        );

        const [existing] = await transaction
          .select({
            id: pointPurchases.id,
            memberId: pointPurchases.memberId,
            itemId: pointPurchases.itemId,
            itemVersion: pointPurchases.itemVersion,
            price: pointPurchases.priceSnapshot,
            status: pointPurchases.status,
          })
          .from(pointPurchases)
          .where(eq(pointPurchases.idempotencyKey, key))
          .limit(1);
        if (existing) {
          if (existing.memberId !== input.memberId || existing.itemId !== input.itemId) {
            throw new PointShopError(
              "SHOP_IDEMPOTENCY_CONFLICT",
              "같은 요청 키가 다른 구매에 이미 사용되었습니다.",
            );
          }
          const [account] = await transaction
            .select({ balance: pointAccounts.cachedBalance })
            .from(pointAccounts)
            .where(eq(pointAccounts.memberId, input.memberId))
            .limit(1);
          return {
            purchaseId: existing.id,
            itemId: existing.itemId,
            itemVersion: existing.itemVersion,
            price: existing.price,
            balance: account?.balance ?? 0,
            idempotent: true,
          };
        }

        const now = new Date();
        const [item] = await transaction
          .select({
            id: pointCatalogItems.id,
            version: pointCatalogItems.currentVersion,
            price: pointCatalogItems.price,
            status: pointCatalogItems.status,
            saleStartAt: pointCatalogItems.saleStartAt,
            saleEndAt: pointCatalogItems.saleEndAt,
          })
          .from(pointCatalogItems)
          .where(eq(pointCatalogItems.id, input.itemId))
          .limit(1);
        if (!item) throw new PointShopError("SHOP_ITEM_NOT_FOUND", "상품을 찾을 수 없습니다.");
        if (
          item.status !== "ACTIVE" ||
          (item.saleStartAt && item.saleStartAt > now) ||
          (item.saleEndAt && item.saleEndAt <= now)
        ) {
          throw new PointShopError("SHOP_ITEM_NOT_FOR_SALE", "현재 판매 중인 상품이 아닙니다.");
        }

        const [owned] = await transaction
          .select({ state: memberInventory.state })
          .from(memberInventory)
          .where(
            and(eq(memberInventory.memberId, input.memberId), eq(memberInventory.itemId, item.id)),
          )
          .limit(1);
        if (owned) {
          throw new PointShopError("SHOP_ITEM_ALREADY_OWNED", "이미 보유한 상품입니다.");
        }

        const purchaseId = randomUUID();
        const spend = await ledger.applyEntryWithinTransaction(transaction, {
          memberId: input.memberId,
          entryType: "SPEND",
          amount: -item.price,
          reasonCode: "POINT_ITEM_PURCHASE",
          sourceType: "POINT_PURCHASE",
          sourceId: purchaseId,
          operationDay: operationDayAt(now),
          idempotencyKey: `${key}:spend`,
          policyVersion: "POINT_SHOP_V1",
          metadata: { itemId: item.id, itemVersion: item.version, price: item.price },
        });

        const [created] = await transaction
          .insert(pointPurchases)
          .values({
            id: purchaseId,
            memberId: input.memberId,
            itemId: item.id,
            itemVersion: item.version,
            priceSnapshot: item.price,
            spendLedgerEntryId: spend.entryId,
            idempotencyKey: key,
          })
          .returning({ id: pointPurchases.id });
        await transaction.insert(memberInventory).values({
          memberId: input.memberId,
          itemId: item.id,
          purchaseId: created!.id,
        });
        await transaction.insert(outboxEvents).values({
          aggregateType: "POINT_PURCHASE",
          aggregateId: created!.id,
          eventType: "POINT_ITEM_PURCHASED",
          schemaVersion: 1,
          payload: {
            purchaseId: created!.id,
            memberId: input.memberId,
            itemId: item.id,
            itemVersion: item.version,
            price: item.price,
          },
        });
        return {
          purchaseId: created!.id,
          itemId: item.id,
          itemVersion: item.version,
          price: item.price,
          balance: spend.account.cachedBalance,
          idempotent: false,
        };
      });
    } catch (error) {
      return mapLedgerError(error);
    }
  }

  async function equip(input: {
    memberId: string;
    equipSlot: PointShopEquipSlot;
    itemId: string;
  }): Promise<PointShopEquipmentResult> {
    return database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ slot: pointCatalogItems.equipSlot, state: memberInventory.state })
        .from(memberInventory)
        .innerJoin(pointCatalogItems, eq(pointCatalogItems.id, memberInventory.itemId))
        .where(
          and(
            eq(memberInventory.memberId, input.memberId),
            eq(memberInventory.itemId, input.itemId),
          ),
        )
        .limit(1);
      if (!owned || owned.state !== "OWNED") {
        throw new PointShopError("SHOP_INVENTORY_NOT_OWNED", "보유한 상품만 장착할 수 있습니다.");
      }
      if (owned.slot !== input.equipSlot) {
        throw new PointShopError("SHOP_SLOT_MISMATCH", "상품의 장착 위치가 일치하지 않습니다.");
      }
      await transaction
        .insert(memberEquipment)
        .values(input)
        .onConflictDoUpdate({
          target: [memberEquipment.memberId, memberEquipment.equipSlot],
          set: { itemId: input.itemId, equippedAt: new Date() },
        });
      return { equipSlot: input.equipSlot, itemId: input.itemId };
    });
  }

  async function unequip(input: {
    memberId: string;
    equipSlot: PointShopEquipSlot;
  }): Promise<PointShopEquipmentResult> {
    await database
      .delete(memberEquipment)
      .where(
        and(
          eq(memberEquipment.memberId, input.memberId),
          eq(memberEquipment.equipSlot, input.equipSlot),
        ),
      );
    return { equipSlot: input.equipSlot, itemId: null };
  }

  async function refund(input: {
    memberId: string;
    purchaseId: string;
    idempotencyKey: string;
  }): Promise<PointShopPurchaseResult> {
    try {
      return await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.memberId}:point-shop`}, 0))`,
        );
        const [purchaseRow] = await transaction
          .select()
          .from(pointPurchases)
          .where(
            and(
              eq(pointPurchases.id, input.purchaseId),
              eq(pointPurchases.memberId, input.memberId),
            ),
          )
          .limit(1);
        if (!purchaseRow || purchaseRow.status !== "COMPLETED") {
          throw new PointShopError(
            "SHOP_PURCHASE_NOT_REFUNDABLE",
            "환불할 수 있는 구매 기록이 아닙니다.",
          );
        }
        const refund = await ledger.applyEntryWithinTransaction(transaction, {
          memberId: input.memberId,
          entryType: "REFUND",
          amount: purchaseRow.priceSnapshot,
          reasonCode: "POINT_ITEM_REFUND",
          sourceType: "POINT_PURCHASE",
          sourceId: purchaseRow.id,
          operationDay: operationDayAt(new Date()),
          idempotencyKey: `${internalIdempotencyKey(input.memberId, input.idempotencyKey)}:refund`,
          policyVersion: "POINT_SHOP_V1",
          metadata: { purchaseId: purchaseRow.id, itemId: purchaseRow.itemId },
        });
        await transaction
          .delete(memberEquipment)
          .where(
            and(
              eq(memberEquipment.memberId, input.memberId),
              eq(memberEquipment.itemId, purchaseRow.itemId),
            ),
          );
        await transaction
          .update(memberInventory)
          .set({ state: "REVOKED", revokedAt: new Date() })
          .where(
            and(
              eq(memberInventory.memberId, input.memberId),
              eq(memberInventory.itemId, purchaseRow.itemId),
            ),
          );
        await transaction
          .update(pointPurchases)
          .set({ status: "REFUNDED", refundLedgerEntryId: refund.entryId, refundedAt: new Date() })
          .where(eq(pointPurchases.id, purchaseRow.id));
        await transaction.insert(outboxEvents).values({
          aggregateType: "POINT_PURCHASE",
          aggregateId: purchaseRow.id,
          eventType: "POINT_ITEM_REFUNDED",
          schemaVersion: 1,
          payload: {
            purchaseId: purchaseRow.id,
            memberId: input.memberId,
            itemId: purchaseRow.itemId,
          },
        });
        return {
          purchaseId: purchaseRow.id,
          itemId: purchaseRow.itemId,
          itemVersion: purchaseRow.itemVersion,
          price: purchaseRow.priceSnapshot,
          balance: refund.account.cachedBalance,
          idempotent: !refund.applied,
        };
      });
    } catch (error) {
      return mapLedgerError(error);
    }
  }

  return { listShop, purchase, equip, unequip, refund };
}
