import { useCallback, useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MemberPointLedgerItem, MemberPointView } from "@/contracts";
import { colors } from "@/theme";

const badgeImages = {
  BRONZE: require("../../../assets/badges/bronze.webp"),
  SILVER: require("../../../assets/badges/silver.webp"),
  GOLD: require("../../../assets/badges/gold.webp"),
  PLATINUM: require("../../../assets/badges/platinum.webp"),
  DIAMOND: require("../../../assets/badges/diamond.webp"),
} as const;

const HIDDEN_TRANSLATE_X = 520;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function amountLabel(item: MemberPointLedgerItem) {
  return `${item.amount > 0 ? "+" : ""}${item.amount.toLocaleString("ko-KR")}P`;
}

export function MemberPointDrawer({
  error,
  loading,
  loadingMore,
  onClose,
  onLoadMore,
  onRetry,
  points,
  visible,
}: {
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  points: MemberPointView | null;
  visible: boolean;
}) {
  const [translateX] = useState(() => new Animated.Value(HIDDEN_TRANSLATE_X));
  const badge = points?.badge.current ?? null;
  const nextBadge = points?.badge.next ?? null;
  const progress = points?.badge.progress ?? 0;

  useEffect(() => {
    if (!visible) return;
    translateX.setValue(HIDDEN_TRANSLATE_X);
    Animated.timing(translateX, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, [translateX, visible]);

  const closeDrawer = useCallback(() => {
    Animated.timing(translateX, {
      duration: 190,
      easing: Easing.in(Easing.cubic),
      toValue: HIDDEN_TRANSLATE_X,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [onClose, translateX]);

  return (
    <Modal
      animationType="none"
      onRequestClose={closeDrawer}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="W Point 닫기"
          accessibilityRole="button"
          onPress={closeDrawer}
          style={styles.backdrop}
        />
        <Animated.View style={[styles.drawerFrame, { transform: [{ translateX }] }]}>
          <SafeAreaView edges={["top", "right", "bottom"]} style={styles.drawer}>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>W POINT</Text>
                <Text accessibilityRole="header" style={styles.title}>
                  나의 W Point
                </Text>
              </View>
              <Pressable
                accessibilityLabel="W Point 패널 닫기"
                accessibilityRole="button"
                hitSlop={12}
                onPress={closeDrawer}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>

            {loading ? <Text style={styles.stateCopy}>포인트 내역을 불러오고 있어요.</Text> : null}
            {error ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateCopy}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
                  <Text style={styles.retryText}>다시 불러오기</Text>
                </Pressable>
              </View>
            ) : null}

            {points ? (
              <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.summary}>
                  <View style={styles.balanceCopy}>
                    <Text style={styles.balance}>
                      {points.account.balance.toLocaleString("ko-KR")}P
                    </Text>
                    <Text style={styles.today}>
                      오늘 +{points.account.todayEarned.toLocaleString("ko-KR")}P
                    </Text>
                    <Text style={styles.lifetime}>
                      누적 획득 {points.account.lifetimeEarned.toLocaleString("ko-KR")}P
                    </Text>
                  </View>
                  {badge ? (
                    <Image
                      accessibilityLabel={`${badge.label} W Point 배지`}
                      source={badgeImages[badge.code]}
                      style={styles.badge}
                    />
                  ) : (
                    <View style={styles.badgePending}>
                      <Text style={styles.badgePendingText}>첫 적립 후{`\n`}배지 획득</Text>
                    </View>
                  )}
                </View>
                <View style={styles.milestone}>
                  <View style={styles.milestoneRow}>
                    <Text style={styles.badgeLabel}>{badge?.label ?? "배지 준비 중"}</Text>
                    <Text style={styles.milestoneCopy}>
                      {nextBadge
                        ? `${nextBadge.label}까지 ${Math.max(0, nextBadge.minimumLifetimePoints - points.account.lifetimeEarned).toLocaleString("ko-KR")}P`
                        : "최고 등급 달성"}
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[styles.progressValue, { width: `${Math.round(progress * 100)}%` }]}
                    />
                  </View>
                </View>

                <Text style={styles.sectionTitle}>최근 적립 내역</Text>
                {points.ledger.items.length === 0 ? (
                  <Text style={styles.emptyCopy}>
                    아직 적립 내역이 없어요. 첫 투표부터 시작해 보세요.
                  </Text>
                ) : (
                  points.ledger.items.map((item) => (
                    <View key={item.id} style={styles.ledgerItem}>
                      <View style={styles.ledgerCopy}>
                        <Text style={styles.ledgerReason}>{item.reasonLabel}</Text>
                        <Text style={styles.ledgerDate}>{dateLabel(item.createdAt)}</Text>
                      </View>
                      <Text style={[styles.ledgerAmount, item.amount < 0 && styles.negative]}>
                        {amountLabel(item)}
                      </Text>
                    </View>
                  ))
                )}
                {points.ledger.nextCursor ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loadingMore}
                    onPress={onLoadMore}
                    style={styles.moreButton}
                  >
                    <Text style={styles.moreText}>
                      {loadingMore ? "불러오는 중…" : "이전 내역 더 보기"}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: "row" },
  backdrop: { backgroundColor: "rgba(8, 25, 31, 0.45)", flex: 1 },
  drawerFrame: {
    backgroundColor: colors.bg,
    maxWidth: 430,
    width: "86%",
  },
  drawer: { flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  eyebrow: { color: colors.cyanStrong, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 3 },
  closeButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  closeText: { color: colors.text, fontSize: 30, fontWeight: "500", lineHeight: 32 },
  content: { gap: 16, padding: 18, paddingBottom: 40 },
  summary: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18,
  },
  balanceCopy: { flex: 1, gap: 3 },
  balance: { color: colors.text, fontSize: 33, fontWeight: "900" },
  today: { color: colors.cyanStrong, fontSize: 15, fontWeight: "900" },
  lifetime: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 5 },
  badge: { height: 92, width: 92 },
  badgePending: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 46,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 92,
    justifyContent: "center",
    width: 92,
  },
  badgePendingText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    textAlign: "center",
  },
  milestone: { gap: 8 },
  milestoneRow: { flexDirection: "row", justifyContent: "space-between" },
  badgeLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  milestoneCopy: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  progressTrack: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 8,
    overflow: "hidden",
  },
  progressValue: { backgroundColor: colors.cyan, borderRadius: 999, height: "100%" },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 4 },
  ledgerItem: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 14,
  },
  ledgerCopy: { flex: 1, gap: 3 },
  ledgerReason: { color: colors.text, fontSize: 14, fontWeight: "800" },
  ledgerDate: { color: colors.textTertiary, fontSize: 11, fontWeight: "600" },
  ledgerAmount: { color: colors.cyanStrong, fontSize: 15, fontWeight: "900" },
  negative: { color: colors.danger },
  emptyCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, paddingVertical: 18 },
  moreButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  moreText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  stateCard: { gap: 12, padding: 20 },
  stateCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, padding: 20 },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 46,
  },
  retryText: { color: "#062A31", fontSize: 13, fontWeight: "900" },
});
