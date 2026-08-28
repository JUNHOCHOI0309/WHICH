export type PointShopEquipSlot = "PROFILE_ACCENT" | "AVATAR_FRAME" | "SHARE_BACKGROUND";

export type PointShopCatalogItem = {
  id: string;
  code: string;
  itemType: string;
  surface: string;
  equipSlot: PointShopEquipSlot;
  themeFamily: string;
  name: string;
  description: string;
  price: number;
  permanent: boolean;
  currentVersion: number;
  assetManifest: Record<string, unknown>;
  previewAssets: Record<string, unknown>;
  accessibilityMetadata: Record<string, unknown>;
  owned: boolean;
  equipped: boolean;
};

export type MemberPointShopView = {
  balance: number;
  catalog: PointShopCatalogItem[];
  equipment: Partial<Record<PointShopEquipSlot, string>>;
};

export type PointShopPurchaseResult = {
  purchaseId: string;
  itemId: string;
  itemVersion: number;
  price: number;
  balance: number;
  idempotent: boolean;
};

export type PointShopEquipmentResult = {
  equipSlot: PointShopEquipSlot;
  itemId: string | null;
};

export interface PointShopService {
  listShop(memberId: string): Promise<MemberPointShopView>;
  purchase(input: {
    memberId: string;
    itemId: string;
    idempotencyKey: string;
  }): Promise<PointShopPurchaseResult>;
  equip(input: {
    memberId: string;
    equipSlot: PointShopEquipSlot;
    itemId: string;
  }): Promise<PointShopEquipmentResult>;
  unequip(input: {
    memberId: string;
    equipSlot: PointShopEquipSlot;
  }): Promise<PointShopEquipmentResult>;
  refund(input: {
    memberId: string;
    purchaseId: string;
    idempotencyKey: string;
  }): Promise<PointShopPurchaseResult>;
}
