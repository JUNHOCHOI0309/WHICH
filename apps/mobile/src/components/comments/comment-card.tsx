import { Pressable, StyleSheet, Text, View } from "react-native";

import type { PublicComment } from "@/contracts";
import { relativeTimeLabel } from "@/lib/relative-time";
import { colors } from "@/theme";

function authorInitial(displayName: string) {
  return Array.from(displayName.trim())[0] ?? "W";
}

export function CommentCard({
  comment,
  busy = false,
  personal = false,
  onHelpful,
  onMore,
}: {
  comment: PublicComment;
  busy?: boolean;
  personal?: boolean;
  onHelpful?: (comment: PublicComment) => void;
  onMore?: (comment: PublicComment) => void;
}) {
  const canOpenMore = Boolean(
    onMore && (comment.reports.canReport || comment.reports.viewerReported),
  );

  return (
    <View
      style={[
        styles.comment,
        personal && (comment.choice === "A" ? styles.commentPersonalA : styles.commentPersonalB),
      ]}
    >
      <View style={styles.commentHeader}>
        <View style={[styles.avatar, comment.choice === "A" ? styles.avatarA : styles.avatarB]}>
          <Text style={styles.avatarText}>{authorInitial(comment.author.displayName)}</Text>
        </View>
        <View style={styles.authorBlock}>
          <View style={styles.authorLine}>
            <Text numberOfLines={1} style={styles.author}>
              {comment.author.displayName}
            </Text>
            <Text style={styles.meta}>{relativeTimeLabel(comment.createdAt)}</Text>
            <Text
              style={[
                styles.choice,
                comment.choice === "A" ? styles.choiceA : styles.choiceB,
              ]}
            >
              {comment.choice}
            </Text>
          </View>
        </View>
        {canOpenMore ? (
          <Pressable
            accessibilityLabel={
              comment.reports.viewerReported ? "신고가 접수된 댓글" : "댓글 더보기"
            }
            accessibilityRole="button"
            disabled={comment.reports.viewerReported || busy}
            hitSlop={10}
            onPress={() => onMore?.(comment)}
            style={styles.moreButton}
          >
            <Text style={styles.moreText}>
              {comment.reports.viewerReported ? "신고됨" : "•••"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.body}>{comment.body}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: comment.reactions.viewerReacted }}
          disabled={!onHelpful || busy}
          onPress={() => onHelpful?.(comment)}
          style={[styles.action, comment.reactions.viewerReacted && styles.actionActive]}
        >
          <Text style={styles.actionText}>
            {comment.reactions.viewerReacted ? "♥" : "♡"} {comment.reactions.helpfulCount}
          </Text>
        </Pressable>
        {comment.editedAt ? <Text style={styles.edited}>수정됨</Text> : null}
      </View>
    </View>
  );
}

export function EmptyCommentCard({
  side,
  personal = false,
}: {
  side: "A" | "B";
  personal?: boolean;
}) {
  return (
    <View
      style={[
        styles.comment,
        personal && (side === "A" ? styles.commentPersonalA : styles.commentPersonalB),
      ]}
    >
      <View style={styles.commentHeader}>
        <View style={[styles.avatar, side === "A" ? styles.avatarA : styles.avatarB]}>
          <Text style={styles.avatarText}>{side}</Text>
        </View>
        <Text style={styles.empty}>아직 {side}를 고른 대표 댓글이 없어요.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  comment: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 1,
    gap: 10,
    padding: 16,
    shadowColor: "#132B36",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
  },
  commentPersonalA: {
    borderColor: colors.cyan,
    borderWidth: 2,
  },
  commentPersonalB: {
    borderColor: colors.orange,
    borderWidth: 2,
  },
  commentHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  avatar: {
    alignItems: "center",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  avatarA: { backgroundColor: colors.cyanSoft },
  avatarB: { backgroundColor: colors.orangeSoft },
  avatarText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  authorBlock: { flex: 1 },
  authorLine: { alignItems: "center", flexDirection: "row", gap: 6 },
  author: { color: colors.text, flexShrink: 1, fontSize: 13, fontWeight: "900" },
  meta: { color: colors.textTertiary, fontSize: 10 },
  choice: {
    borderRadius: 999,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  choiceA: { backgroundColor: colors.cyan, color: "#ffffff" },
  choiceB: { backgroundColor: "#C7F21E", color: "#446000" },
  moreButton: { alignItems: "center", justifyContent: "center", minHeight: 32, minWidth: 38 },
  moreText: { color: colors.textTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  body: { color: colors.text, fontSize: 14, lineHeight: 22, paddingLeft: 48 },
  actions: { alignItems: "center", flexDirection: "row", gap: 8, paddingLeft: 48 },
  action: { borderRadius: 999, paddingHorizontal: 4, paddingVertical: 5 },
  actionActive: { backgroundColor: colors.cyanSoft },
  actionText: { color: colors.textSecondary, fontSize: 11, fontWeight: "800" },
  edited: { color: colors.textTertiary, fontSize: 10 },
  empty: { color: colors.textTertiary, flex: 1, fontSize: 12, lineHeight: 18 },
});
