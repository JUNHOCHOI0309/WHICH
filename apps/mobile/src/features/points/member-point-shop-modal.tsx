import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MemberPointShopView, PointShopCatalogItem, PointShopEquipSlot } from "@/contracts";
import {
  avatarFrameStyle,
  cosmeticTokens,
  profileAccentStyle,
  shareBackgroundStyle,
} from "@/lib/point-shop-cosmetics";
import { colors } from "@/theme";

const slotLabels = {
  PROFILE_ACCENT: "프로필 컬러",
  AVATAR_FRAME: "아바타 프레임",
  SHARE_BACKGROUND: "공유 배경",
} as const;

const shopSlots = Object.keys(slotLabels) as PointShopEquipSlot[];

function CosmeticPreview({ item }: { item: PointShopCatalogItem | null }) {
  if (!item) {
    return (
      <View style={styles.emptyPreview}>
        <Text style={styles.emptyPreviewTitle}>상품을 선택해 주세요.</Text>
        <Text style={styles.emptyPreviewCopy}>
          목록의 상품을 누르면 실제 적용 모습을 먼저 확인할 수 있어요.
        </Text>
      </View>
    );
  }

  const tokens = cosmeticTokens(item.themeFamily);

  return (
    <View style={styles.previewStage}>
      <View style={styles.previewMeta}>
        <Text style={styles.slotLabel}>{slotLabels[item.equipSlot]}</Text>
        <Text style={styles.previewTitle}>{item.name}</Text>
        <Text style={styles.previewDescription}>{item.description}</Text>
      </View>

      {item.equipSlot === "PROFILE_ACCENT" ? (
        <View style={[styles.profileMock, profileAccentStyle(item)]}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>W</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileEyebrow}>PRIVATE MEMBER PROFILE</Text>
            <Text numberOfLines={1} style={styles.profileTitle}>
              WHICH 회원님의 선택
            </Text>
            <View style={[styles.accentSwatch, { backgroundColor: tokens.accent }]} />
          </View>
        </View>
      ) : null}

      {item.equipSlot === "AVATAR_FRAME" ? (
        <View style={styles.avatarPreview}>
          <View style={[styles.avatarFrame, avatarFrameStyle(item)]}>
            <Text style={styles.avatarLetter}>W</Text>
          </View>
          <Text style={styles.avatarPreviewTitle}>프로필 이미지 프레임</Text>
          <Text style={styles.avatarPreviewCopy}>프로필과 댓글의 아바타에 적용됩니다.</Text>
        </View>
      ) : null}

      {item.equipSlot === "SHARE_BACKGROUND" ? (
        <View style={[styles.shareMock, shareBackgroundStyle(item)]}>
          <Text style={styles.shareEyebrow}>WHICH · RESULT</Text>
          <Text style={styles.shareTitle}>당신의 선택은 어느 쪽인가요?</Text>
          <View style={styles.shareResult}>
            <Text style={styles.shareA}>A · 42%</Text>
            <Text style={styles.shareB}>B · 58%</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function MemberPointShopModal({
  onAction,
  onClose,
  onPreview,
  pending,
  previewItem,
  shop,
  visible,
}: {
  onAction: (item: PointShopCatalogItem) => void;
  onClose: () => void;
  onPreview: (item: PointShopCatalogItem) => void;
  pending: boolean;
  previewItem: PointShopCatalogItem | null;
  shop: MemberPointShopView | null;
  visible: boolean;
}) {
  const [activeSlot, setActiveSlot] = useState<PointShopEquipSlot>("PROFILE_ACCENT");

  const filteredCatalog = shop?.catalog.filter((item) => item.equipSlot === activeSlot) ?? [];

  const selectSlot = (slot: PointShopEquipSlot) => {
    setActiveSlot(slot);
    const firstItem = shop?.catalog.find((item) => item.equipSlot === slot);
    if (firstItem) onPreview(firstItem);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <SafeAreaView edges={["top", "bottom"]} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerEyebrow}>W POINT SHOP</Text>
              <Text accessibilityRole="header" style={styles.headerTitle}>
                나만의 WHICH를 골라보세요.
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Text style={styles.balance}>{shop?.balance.toLocaleString("ko-KR") ?? "—"}P</Text>
              <Pressable
                accessibilityLabel="W Point 상점 닫기"
                accessibilityRole="button"
                hitSlop={10}
                onPress={onClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>LIVE PREVIEW</Text>
            <CosmeticPreview item={previewItem} />
            {previewItem ? (
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => onAction(previewItem)}
                style={[styles.primaryAction, pending && styles.disabled]}
              >
                <Text style={styles.primaryActionText}>
                  {previewItem.equipped
                    ? "착용 해제하기"
                    : previewItem.owned
                      ? "적용하기"
                      : `${previewItem.price.toLocaleString("ko-KR")}P로 구매`}
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.catalogHeading}>
              <View>
                <Text style={styles.sectionLabel}>CATALOG</Text>
                <Text style={styles.catalogTitle}>꾸미기 상품</Text>
              </View>
            </View>

            <ScrollView
              accessibilityLabel="상품 종류"
              contentContainerStyle={styles.catalogTabs}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {shopSlots.map((slot) => {
                const active = activeSlot === slot;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    key={slot}
                    onPress={() => selectSlot(slot)}
                    style={[styles.catalogTab, active && styles.catalogTabActive]}
                  >
                    <Text style={[styles.catalogTabText, active && styles.catalogTabTextActive]}>
                      {slotLabels[slot]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {pending && !shop ? <Text style={styles.loading}>상품을 불러오는 중…</Text> : null}
            <View style={styles.catalogGrid}>
              {filteredCatalog.map((item) => {
                const tokens = cosmeticTokens(item.themeFamily);
                const selected = previewItem?.id === item.id;
                return (
                  <Pressable
                    accessibilityHint="상품이 적용된 모습을 미리 봅니다."
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => onPreview(item)}
                    style={[styles.productCard, selected && styles.productCardSelected]}
                  >
                    <View
                      style={[
                        styles.productVisual,
                        { backgroundColor: tokens.soft, borderColor: tokens.accent },
                      ]}
                    >
                      <View style={[styles.productSwatch, { backgroundColor: tokens.accent }]} />
                    </View>
                    <Text style={styles.productSlot}>{slotLabels[item.equipSlot]}</Text>
                    <Text numberOfLines={1} style={styles.productName}>
                      {item.name}
                    </Text>
                    <Text style={styles.productStatus}>
                      {item.equipped
                        ? "착용 됨"
                        : item.owned
                          ? "보유 중"
                          : `${item.price.toLocaleString("ko-KR")}P`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!pending && shop && filteredCatalog.length === 0 ? (
              <Text style={styles.catalogEmpty}>이 종류의 상품은 아직 준비 중이에요.</Text>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(4, 20, 27, 0.62)",
    flex: 1,
    justifyContent: "center",
    padding: 14,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.cyan,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: "94%",
    maxWidth: 680,
    overflow: "hidden",
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18,
  },
  headerCopy: { flex: 1, paddingRight: 10 },
  headerEyebrow: {
    color: colors.cyanStrong,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  headerTitle: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 4 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 9 },
  balance: { color: colors.cyanStrong, fontSize: 16, fontWeight: "900" },
  closeButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  closeText: { color: colors.text, fontSize: 28, lineHeight: 30 },
  content: { padding: 18, paddingBottom: 30 },
  sectionLabel: {
    color: colors.cyanStrong,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 7,
  },
  emptyPreview: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 280,
    padding: 22,
  },
  emptyPreviewTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  emptyPreviewCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  previewStage: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 20,
    borderWidth: 1,
    gap: 20,
    minHeight: 310,
    padding: 20,
  },
  previewMeta: { gap: 5 },
  slotLabel: { color: colors.cyanStrong, fontSize: 10, fontWeight: "900" },
  previewTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  previewDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  profileMock: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 2,
    flexDirection: "row",
    gap: 13,
    padding: 16,
  },
  profileAvatar: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  profileAvatarText: { color: colors.surface, fontSize: 20, fontWeight: "900" },
  profileCopy: { flex: 1, gap: 5 },
  profileEyebrow: { color: colors.cyanStrong, fontSize: 8, fontWeight: "900" },
  profileTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  accentSwatch: { borderRadius: 999, height: 6, width: 54 },
  avatarPreview: { alignItems: "center", gap: 7 },
  avatarFrame: {
    alignItems: "center",
    backgroundColor: colors.text,
    height: 116,
    justifyContent: "center",
    width: 116,
  },
  avatarLetter: { color: colors.surface, fontSize: 38, fontWeight: "900" },
  avatarPreviewTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  avatarPreviewCopy: { color: colors.textSecondary, fontSize: 11 },
  shareMock: {
    borderRadius: 18,
    gap: 11,
    justifyContent: "flex-end",
    minHeight: 165,
    padding: 18,
  },
  shareEyebrow: { color: colors.text, fontSize: 9, fontWeight: "900" },
  shareTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  shareResult: { flexDirection: "row" },
  shareA: {
    backgroundColor: colors.cyan,
    color: "#062A31",
    flex: 0.42,
    fontSize: 11,
    fontWeight: "900",
    padding: 10,
  },
  shareB: {
    backgroundColor: colors.orange,
    color: "#361301",
    flex: 0.58,
    fontSize: 11,
    fontWeight: "900",
    padding: 10,
    textAlign: "right",
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 50,
  },
  primaryActionText: { color: colors.surface, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  catalogHeading: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
    marginTop: 28,
  },
  catalogTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  catalogTabs: { gap: 8, paddingBottom: 14 },
  catalogTab: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 15,
  },
  catalogTabActive: { backgroundColor: colors.text, borderColor: colors.text },
  catalogTabText: { color: colors.textSecondary, fontSize: 12, fontWeight: "900" },
  catalogTabTextActive: { color: colors.surface },
  loading: { color: colors.textSecondary, fontSize: 13, paddingVertical: 16 },
  catalogEmpty: { color: colors.textSecondary, fontSize: 13, paddingVertical: 22 },
  catalogGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  productCard: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 11,
    width: "48.4%",
  },
  productCardSelected: { borderColor: colors.cyan, borderWidth: 2, padding: 10 },
  productVisual: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    marginBottom: 3,
  },
  productSwatch: { borderRadius: 999, height: 9, width: 48 },
  productSlot: { color: colors.textSecondary, fontSize: 9, fontWeight: "800" },
  productName: { color: colors.text, fontSize: 13, fontWeight: "900" },
  productStatus: { color: colors.cyanStrong, fontSize: 10, fontWeight: "900" },
});
