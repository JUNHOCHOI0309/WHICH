import type { CSSProperties } from "react";

import type {
  MemberPointShopView,
  PointShopCatalogItem,
  PointShopEquipSlot,
} from "@/lib/contracts";

type ThemeTokens = {
  accent: string;
  accentSoft: string;
  border: string;
  shadow: string;
  background: string;
};

const themes: Record<string, ThemeTokens> = {
  SIGNAL_GRID: {
    accent: "#15c4d6",
    accentSoft: "#dff8fb",
    border: "#15c4d6",
    shadow: "0 0 0 4px rgba(21,196,214,.2), 0 12px 28px rgba(6,42,84,.22)",
    background:
      "linear-gradient(rgba(21,196,214,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(21,196,214,.13) 1px,transparent 1px),linear-gradient(135deg,#061d3c,#0a4663)",
  },
  PAPER_VOTE: {
    accent: "#856b42",
    accentSoft: "#f7f0df",
    border: "#b69761",
    shadow: "0 0 0 4px rgba(182,151,97,.18), 0 12px 28px rgba(76,59,35,.18)",
    background:
      "repeating-linear-gradient(0deg,rgba(133,107,66,.08) 0 1px,transparent 1px 12px),linear-gradient(135deg,#fffdf6,#eadfc5)",
  },
  NEON_RIFT: {
    accent: "#8b5cf6",
    accentSoft: "#eee8ff",
    border: "#8b5cf6",
    shadow: "0 0 0 4px rgba(139,92,246,.2), 0 0 30px rgba(21,196,214,.36)",
    background:
      "radial-gradient(circle at 20% 20%,rgba(21,196,214,.55),transparent 32%),radial-gradient(circle at 80% 70%,rgba(255,122,26,.48),transparent 35%),linear-gradient(135deg,#120b2e,#061d3c)",
  },
  SOFT_ORBIT: {
    accent: "#4fa9a3",
    accentSoft: "#e6f6f2",
    border: "#79c9bd",
    shadow: "0 0 0 4px rgba(121,201,189,.2), 0 12px 28px rgba(79,169,163,.2)",
    background:
      "radial-gradient(circle at 15% 20%,#fff 0 8%,transparent 9%),radial-gradient(circle at 85% 75%,#ffd7bf 0 12%,transparent 13%),linear-gradient(135deg,#def7f1,#dfe8ff)",
  },
};

export function cosmeticTokens(themeFamily?: string | null): ThemeTokens {
  return themes[themeFamily ?? ""] ?? themes.SIGNAL_GRID!;
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

export function profileAccentStyle(item?: PointShopCatalogItem | null): CSSProperties | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return {
    borderColor: token.border,
    background: `linear-gradient(135deg, ${token.accentSoft}, #fff 58%)`,
    boxShadow: `inset 5px 0 0 ${token.accent}`,
  };
}

export function avatarFrameStyle(item?: PointShopCatalogItem | null): CSSProperties | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return {
    border: `4px solid ${token.border}`,
    borderRadius: "999px",
    boxShadow: token.shadow,
    padding: "4px",
  };
}

export function shareBackgroundStyle(
  item?: PointShopCatalogItem | null,
): CSSProperties | undefined {
  if (!item) return undefined;
  const token = cosmeticTokens(item.themeFamily);
  return {
    background: token.background,
    backgroundSize: item.themeFamily === "SIGNAL_GRID" ? "22px 22px,22px 22px,auto" : undefined,
    borderColor: token.border,
    color:
      item.themeFamily === "SIGNAL_GRID" || item.themeFamily === "NEON_RIFT" ? "#fff" : undefined,
  };
}
