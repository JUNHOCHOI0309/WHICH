import type { ViewStyle } from "react-native";

import type { MemberPointShopView, PointShopCatalogItem, PointShopEquipSlot } from "@/contracts";

const themes = {
  SIGNAL_GRID: { accent: "#15C4D6", soft: "#DFF8FB", dark: "#062A54" },
  PAPER_VOTE: { accent: "#B69761", soft: "#F7F0DF", dark: "#5F492C" },
  NEON_RIFT: { accent: "#8B5CF6", soft: "#EEE8FF", dark: "#120B2E" },
  SOFT_ORBIT: { accent: "#79C9BD", soft: "#E6F6F2", dark: "#397E79" },
} as const;

export function cosmeticTokens(themeFamily?: string | null) {
  return themes[themeFamily as keyof typeof themes] ?? themes.SIGNAL_GRID;
}

export function equippedShopItem(
  shop: MemberPointShopView | null | undefined,
  slot: PointShopEquipSlot,
) {
  const itemId = shop?.equipment?.[slot];
  return itemId && Array.isArray(shop?.catalog)
    ? (shop.catalog.find((item) => item.id === itemId) ?? null)
    : null;
}

export function profileAccentStyle(item?: PointShopCatalogItem | null): ViewStyle | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return { backgroundColor: token.soft, borderColor: token.accent, borderLeftWidth: 5 };
}

export function avatarFrameStyle(item?: PointShopCatalogItem | null): ViewStyle | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return {
    borderColor: token.accent,
    borderRadius: 999,
    borderWidth: 4,
    elevation: 8,
    padding: 4,
    shadowColor: token.dark,
    shadowOpacity: 0.28,
    shadowRadius: 10,
  };
}

export function shareBackgroundStyle(item?: PointShopCatalogItem | null): ViewStyle | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return { backgroundColor: token.soft, borderColor: token.accent, borderWidth: 2 };
}
