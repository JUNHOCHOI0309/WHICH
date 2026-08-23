import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from "react-native";

import type { CommentHighlight, CommentHighlights } from "@/contracts";
import { colors } from "@/theme";

const ROTATION_INTERVAL_MS = 6_000;

export function RotatingCommentHighlights({
  highlights,
  loading,
  error,
  onRetry,
  onOpenAll,
}: {
  highlights: CommentHighlights | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpenAll: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
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
    if (total <= 1 || userPaused || reducedMotion || !appActive) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % total),
      ROTATION_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [appActive, reducedMotion, total, userPaused]);

  const rotate = useCallback(
    (direction: -1 | 1) => {
      if (total <= 1) return;
      setIndex((current) => (current + direction + total) % total);
    },
    [total],
  );

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
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CHOICE VOICES</Text>
          <Text accessibilityRole="header" style={styles.title}>
            A·B 대표 댓글
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onOpenAll}>
          <Text style={styles.openAll}>전체 댓글</Text>
        </Pressable>
      </View>

      {total === 0 ? (
        <Text style={styles.empty}>아직 공개된 대표 댓글이 없어요. 첫 선택 이유를 남겨보세요.</Text>
      ) : (
        <>
          <HighlightCard side="A" comment={comments.A} />
          <HighlightCard side="B" comment={comments.B} />
          {total > 1 ? (
            <View accessibilityLabel="대표 댓글 순환 제어" style={styles.controls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="이전 대표 댓글"
                onPress={() => rotate(-1)}
                style={styles.controlButton}
              >
                <Text style={styles.controlText}>←</Text>
              </Pressable>
              <Text style={styles.counter}>
                {safeIndex + 1} / {total}
              </Text>
              {!reducedMotion ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: userPaused }}
                  onPress={() => setUserPaused((current) => !current)}
                  style={styles.controlButtonWide}
                >
                  <Text style={styles.controlText}>{userPaused ? "자동 재생" : "일시정지"}</Text>
                </Pressable>
              ) : (
                <Text style={styles.counter}>자동 순환 꺼짐</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다음 대표 댓글"
                onPress={() => rotate(1)}
                style={styles.controlButton}
              >
                <Text style={styles.controlText}>→</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function HighlightCard({ side, comment }: { side: "A" | "B"; comment: CommentHighlight | null }) {
  return (
    <View style={[styles.comment, side === "A" ? styles.commentA : styles.commentB]}>
      <View style={styles.commentMeta}>
        <Text style={[styles.side, side === "A" ? styles.sideA : styles.sideB]}>{side}</Text>
        {comment ? <Text style={styles.meta}>공감 {comment.reactions.helpfulCount}</Text> : null}
      </View>
      {comment ? (
        <>
          <Text numberOfLines={2} style={styles.body}>
            {comment.body}
          </Text>
          <Text style={styles.meta}>{comment.author.displayName}</Text>
        </>
      ) : (
        <Text style={styles.emptySide}>아직 {side}를 고른 대표 댓글이 없어요.</Text>
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
  header: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: colors.textTertiary, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 3 },
  openAll: { color: colors.textSecondary, fontSize: 11, fontWeight: "800" },
  comment: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: 11,
    borderWidth: 1,
    gap: 8,
    minHeight: 96,
    padding: 12,
  },
  commentA: { borderLeftColor: colors.cyan },
  commentB: { borderLeftColor: colors.orange },
  commentMeta: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  side: { fontSize: 11, fontWeight: "900" },
  sideA: { color: colors.cyanStrong },
  sideB: { color: colors.orangeStrong },
  body: { color: colors.text, fontSize: 12, fontWeight: "600", lineHeight: 18 },
  meta: { color: colors.textTertiary, fontSize: 9, fontWeight: "600" },
  emptySide: { color: colors.textTertiary, fontSize: 11, lineHeight: 17 },
  empty: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 10,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 17,
    padding: 12,
  },
  controls: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  controlButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    minWidth: 32,
  },
  controlButtonWide: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10,
  },
  controlText: { color: colors.textSecondary, fontSize: 10, fontWeight: "800" },
  counter: { color: colors.textTertiary, fontSize: 10, fontWeight: "700" },
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
