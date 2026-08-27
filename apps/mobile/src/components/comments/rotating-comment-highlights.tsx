import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from "react-native";

import type { CommentHighlights } from "@/contracts";
import { colors } from "@/theme";

import { CommentCard, EmptyCommentCard } from "./comment-card";

const ROTATION_INTERVAL_MS = 6_000;

export function RotatingCommentHighlights({
  highlights,
  loading,
  error,
  onRetry,
}: {
  highlights: CommentHighlights | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const total = Math.max(highlights?.A.length ?? 0, highlights?.B.length ?? 0);
  const safeIndex = total > 0 ? index % total : 0;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (total <= 1 || reducedMotion || !appActive) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % total),
      ROTATION_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [appActive, reducedMotion, total]);

  const comments = useMemo(
    () => ({
      A: highlights?.A.length ? (highlights.A[safeIndex % highlights.A.length] ?? null) : null,
      B: highlights?.B.length ? (highlights.B[safeIndex % highlights.B.length] ?? null) : null,
    }),
    [highlights, safeIndex],
  );

  if (loading) {
    return (
      <View
        accessibilityLabel="대표 댓글을 불러오는 중"
        accessibilityState={{ busy: true }}
        style={styles.wrap}
      >
        <View style={styles.loadingTitle} />
        <View style={styles.loadingCard} />
        <View style={styles.loadingCard} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.message}>
        <Text style={styles.messageText}>대표 댓글을 불러오지 못했어요.</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}>
          <Text style={styles.actionText}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  if (!highlights) return null;

  return (
    <View style={styles.wrap}>
      {total === 0 ? (
        <Text style={styles.empty}>아직 공개된 대표 댓글이 없어요. 첫 선택 이유를 남겨보세요.</Text>
      ) : (
        <>
          {comments.A ? (
            <CommentCard comment={comments.A} personal />
          ) : (
            <EmptyCommentCard personal side="A" />
          )}
          {comments.B ? (
            <CommentCard comment={comments.B} personal />
          ) : (
            <EmptyCommentCard personal side="B" />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
  },
  empty: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 17,
    padding: 12,
  },
  message: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    padding: 12,
  },
  messageText: { color: colors.textTertiary, flex: 1, fontSize: 11 },
  actionButton: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  actionText: { color: colors.textSecondary, fontSize: 10, fontWeight: "800" },
  loadingTitle: { backgroundColor: colors.surfaceSubtle, borderRadius: 8, height: 20, width: 120 },
  loadingCard: { backgroundColor: colors.surfaceSubtle, borderRadius: 11, height: 96 },
});
