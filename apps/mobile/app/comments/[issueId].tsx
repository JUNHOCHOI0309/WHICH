import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { CommentReportReason, PublicComment, PublicIssue, VoteResponse } from "@/contracts";
import { guestSubjects, memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

type Side = "ALL" | "A" | "B";

function mapCommentTree(
  comments: PublicComment[],
  update: (comment: PublicComment) => PublicComment,
): PublicComment[] {
  return comments.map((comment) => {
    const next = update(comment);
    return { ...next, replies: mapCommentTree(next.replies ?? [], update) };
  });
}

export default function CommentsScreen() {
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [vote, setVote] = useState<VoteResponse | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [side, setSide] = useState<Side>("ALL");
  const [cursor, setCursor] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState<{ parentCommentId: string; body: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyticsSessionId = useRef(randomUUID());
  const submissionKey = useRef(randomUUID());
  const replySubmissionKey = useRef(randomUUID());

  const load = useCallback(
    async (selectedSide: Side = side) => {
      if (!issueId) return;
      setLoading(true);
      setError(null);
      try {
        const nextSubjectId = await guestSubjects.getOrCreate();
        const session = await memberSessions.restore().catch(() => null);
        const [loadedIssue, loadedVote, page] = await Promise.all([
          mobileApi.loadIssue(issueId, nextSubjectId, session?.token),
          session ? mobileApi.loadMemberVote(session.token, issueId) : Promise.resolve(null),
          mobileApi.loadComments({
            issueId,
            subjectId: nextSubjectId,
            sessionToken: session?.token,
            side: selectedSide,
          }),
        ]);
        setSubjectId(nextSubjectId);
        setSessionToken(session?.token ?? null);
        setIssue(loadedIssue);
        setVote(loadedVote);
        setComments(page.items);
        setCursor(page.nextCursor);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "댓글을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [issueId, side],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  function selectSide(nextSide: Side) {
    if (nextSide === side || loading) return;
    setSide(nextSide);
  }

  async function loadMore() {
    if (!issueId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await mobileApi.loadComments({
        issueId,
        subjectId: subjectId ?? undefined,
        sessionToken: sessionToken ?? undefined,
        side,
        cursor,
      });
      setComments((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "다음 댓글을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function submitComment() {
    const body = draft.trim();
    if (!issueId || !issue || !sessionToken || submitting || !body) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await mobileApi.submitComment({
        issueId,
        subjectId: subjectId ?? undefined,
        sessionToken,
        idempotencyKey: submissionKey.current,
        body,
      });
      submissionKey.current = randomUUID();
      setDraft("");
      setComments((current) => [result.comment, ...current]);
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "COMMENT_COMPLETE",
          issueId,
          issueVersion: issue.version,
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "댓글을 게시하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply() {
    const body = replyDraft?.body.trim();
    if (!issueId || !sessionToken || !replyDraft || !body || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await mobileApi.submitComment({
        issueId,
        subjectId: subjectId ?? undefined,
        sessionToken,
        idempotencyKey: replySubmissionKey.current,
        parentCommentId: replyDraft.parentCommentId,
        body,
      });
      replySubmissionKey.current = randomUUID();
      setComments((current) =>
        mapCommentTree(current, (comment) =>
          comment.id === replyDraft.parentCommentId
            ? { ...comment, replies: [...(comment.replies ?? []), result.comment] }
            : comment,
        ),
      );
      setReplyDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "답글을 작성하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleReaction(comment: PublicComment, code: "HELPFUL" | "DISLIKE") {
    if (busyCommentId) return;
    setBusyCommentId(comment.id);
    setError(null);
    try {
      const result = await mobileApi.toggleCommentReaction({
        commentId: comment.id,
        subjectId: subjectId ?? undefined,
        sessionToken: sessionToken ?? undefined,
        idempotencyKey: randomUUID(),
        code,
      });
      setComments((current) =>
        mapCommentTree(current, (item) =>
          item.id === comment.id
            ? {
                ...item,
                reactions: {
                  helpfulCount: result.reaction.helpfulCount,
                  dislikeCount: result.reaction.dislikeCount,
                  viewerReaction: result.reaction.active ? result.reaction.code : null,
                },
              }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "반응 상태를 변경하지 못했습니다.");
    } finally {
      setBusyCommentId(null);
    }
  }

  async function report(comment: PublicComment, reason: CommentReportReason) {
    if (!issue || busyCommentId) return;
    setBusyCommentId(comment.id);
    setError(null);
    try {
      const result = await mobileApi.reportComment({
        commentId: comment.id,
        subjectId: subjectId ?? undefined,
        sessionToken: sessionToken ?? undefined,
        idempotencyKey: randomUUID(),
        reason,
      });
      const visibility = result.comment.visibility;
      setComments((current) =>
        visibility === "HIDDEN"
          ? current
              .filter((item) => item.id !== comment.id)
              .map((item) => ({
                ...item,
                replies: item.replies.filter((reply) => reply.id !== comment.id),
              }))
          : mapCommentTree(current, (item) =>
              item.id === comment.id
                ? {
                    ...item,
                    visibility,
                    reports: { canReport: false, viewerReported: true },
                  }
                : item,
            ),
      );
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "COMMENT_REPORT_COMPLETE",
          issueId: issue.id,
          issueVersion: issue.version,
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    } catch (reasonValue) {
      setError(
        reasonValue instanceof Error ? reasonValue.message : "댓글 신고를 접수하지 못했습니다.",
      );
    } finally {
      setBusyCommentId(null);
    }
  }

  function openReport(comment: PublicComment) {
    Alert.alert("댓글 신고", "가장 가까운 신고 사유를 선택해 주세요.", [
      { text: "스팸", onPress: () => void report(comment, "SPAM") },
      { text: "괴롭힘", onPress: () => void report(comment, "HARASSMENT") },
      { text: "혐오·욕설", onPress: () => void report(comment, "HATE_OR_ABUSE") },
      { text: "개인정보", onPress: () => void report(comment, "PERSONAL_INFORMATION") },
      { text: "취소", style: "cancel" },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>CHOICE REASONS</Text>
          <Text accessibilityRole="header" style={styles.title}>
            사람들은 이렇게 골랐어요
          </Text>
          {issue ? <Text style={styles.question}>{issue.question}</Text> : null}
        </View>

        <View accessibilityLabel="댓글 선택지 필터" style={styles.filters}>
          {(["ALL", "A", "B"] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: side === item }}
              onPress={() => selectSide(item)}
              style={[styles.filter, side === item && styles.filterActive]}
            >
              <Text style={[styles.filterText, side === item && styles.filterTextActive]}>
                {item === "ALL" ? "전체" : item}
              </Text>
            </Pressable>
          ))}
        </View>

        {sessionToken ? (
          <View style={styles.composer}>
            <Text style={styles.composerTitle}>내 선택 이유</Text>
            <TextInput
              accessibilityLabel="내 선택 이유"
              maxLength={500}
              multiline
              onChangeText={setDraft}
              placeholder="왜 이 선택을 했는지 짧게 남겨보세요."
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={draft}
            />
            <View style={styles.composerFooter}>
              <Text style={styles.count}>{Array.from(draft).length}/500</Text>
              <Pressable
                accessibilityRole="button"
                disabled={!draft.trim() || submitting}
                onPress={() => void submitComment()}
                style={[styles.submit, (!draft.trim() || submitting) && styles.disabled]}
              >
                <Text style={styles.submitText}>{submitting ? "작성 중…" : "작성"}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.loginCard}>
            <Text style={styles.loginText}>댓글 작성은 로그인한 Member만 할 수 있어요.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/login", params: { returnTo: `/comments/${issueId}` } })
              }
              style={styles.loginButton}
            >
              <Text style={styles.loginButtonText}>로그인하기</Text>
            </Pressable>
          </View>
        )}

        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <View style={styles.list}>
          {comments.length === 0 ? (
            <Text style={styles.empty}>아직 공개된 선택 이유가 없어요.</Text>
          ) : (
            comments.map((comment) => (
              <View key={comment.id} style={styles.comment}>
                <View style={styles.commentHeader}>
                  <Text
                    style={[
                      styles.choice,
                      comment.choice === "A" ? styles.choiceA : styles.choiceB,
                    ]}
                  >
                    {comment.choice}
                  </Text>
                  <View style={styles.authorBlock}>
                    <Text style={styles.author}>{comment.author.displayName}</Text>
                    <Text style={styles.meta}>{dateLabel(comment.createdAt)}</Text>
                  </View>
                </View>
                <Text style={styles.body}>{comment.body}</Text>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: comment.reactions.viewerReaction === "HELPFUL",
                    }}
                    disabled={busyCommentId === comment.id}
                    onPress={() => void toggleReaction(comment, "HELPFUL")}
                    style={[
                      styles.action,
                      comment.reactions.viewerReaction === "HELPFUL" && styles.actionActive,
                    ]}
                  >
                    <Text style={styles.actionText}>♡ 공감 {comment.reactions.helpfulCount}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: comment.reactions.viewerReaction === "DISLIKE",
                    }}
                    disabled={busyCommentId === comment.id}
                    onPress={() => void toggleReaction(comment, "DISLIKE")}
                    style={[
                      styles.action,
                      comment.reactions.viewerReaction === "DISLIKE" && styles.actionDislike,
                    ]}
                  >
                    <Text style={styles.actionText}>싫어요 {comment.reactions.dislikeCount}</Text>
                  </Pressable>
                  {comment.threadState === "OPEN" ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setReplyDraft({ parentCommentId: comment.id, body: "" })}
                      style={styles.action}
                    >
                      <Text style={styles.actionText}>답글</Text>
                    </Pressable>
                  ) : null}
                  {comment.reports.canReport || comment.reports.viewerReported ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={comment.reports.viewerReported || busyCommentId === comment.id}
                      onPress={() => openReport(comment)}
                      style={styles.action}
                    >
                      <Text style={styles.actionText}>
                        {comment.reports.viewerReported ? "신고 완료" : "신고"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {replyDraft?.parentCommentId === comment.id ? (
                  <View style={styles.replyComposer}>
                    <TextInput
                      accessibilityLabel="답글 작성"
                      maxLength={500}
                      multiline
                      onChangeText={(body) => setReplyDraft({ parentCommentId: comment.id, body })}
                      placeholder={`${comment.author.displayName}님에게 답글을 남겨보세요.`}
                      placeholderTextColor={colors.textTertiary}
                      style={styles.replyInput}
                      value={replyDraft.body}
                    />
                    <View style={styles.replyComposerActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={!replyDraft.body.trim() || submitting}
                        onPress={() => void submitReply()}
                        style={styles.replySubmit}
                      >
                        <Text style={styles.submitText}>{submitting ? "작성 중…" : "작성"}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={submitting}
                        onPress={() => setReplyDraft(null)}
                        style={styles.action}
                      >
                        <Text style={styles.actionText}>취소</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {comment.replies.length > 0 ? (
                  <View accessibilityLabel="답글 목록" style={styles.replies}>
                    {comment.replies.map((reply) => (
                      <View key={reply.id} style={styles.reply}>
                        <View style={styles.commentHeader}>
                          <Text
                            style={[
                              styles.choice,
                              reply.choice === "A" ? styles.choiceA : styles.choiceB,
                            ]}
                          >
                            {reply.choice}
                          </Text>
                          <View style={styles.authorBlock}>
                            <Text style={styles.author}>{reply.author.displayName}</Text>
                            <Text style={styles.meta}>{dateLabel(reply.createdAt)}</Text>
                          </View>
                        </View>
                        <Text style={styles.body}>{reply.body}</Text>
                        <View style={styles.actions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={busyCommentId === reply.id}
                            onPress={() => void toggleReaction(reply, "HELPFUL")}
                            style={[
                              styles.action,
                              reply.reactions.viewerReaction === "HELPFUL" && styles.actionActive,
                            ]}
                          >
                            <Text style={styles.actionText}>
                              ♡ 공감 {reply.reactions.helpfulCount}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={busyCommentId === reply.id}
                            onPress={() => void toggleReaction(reply, "DISLIKE")}
                            style={[
                              styles.action,
                              reply.reactions.viewerReaction === "DISLIKE" && styles.actionDislike,
                            ]}
                          >
                            <Text style={styles.actionText}>
                              싫어요 {reply.reactions.dislikeCount}
                            </Text>
                          </Pressable>
                          {reply.reports.canReport || reply.reports.viewerReported ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={reply.reports.viewerReported || busyCommentId === reply.id}
                              onPress={() => openReport(reply)}
                              style={styles.action}
                            >
                              <Text style={styles.actionText}>
                                {reply.reports.viewerReported ? "신고 완료" : "신고"}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>

        {cursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreText}>{loadingMore ? "불러오는 중…" : "댓글 더 보기"}</Text>
          </Pressable>
        ) : null}

        {vote ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>결과로 돌아가기</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: 16, padding: 16, paddingBottom: 48 },
  center: { alignItems: "center", backgroundColor: colors.bg, flex: 1, justifyContent: "center" },
  heading: { gap: 6 },
  eyebrow: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 34 },
  question: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  filters: { flexDirection: "row", gap: 8 },
  filter: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 62,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterActive: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  filterText: { color: colors.textSecondary, fontSize: 13, fontWeight: "800", textAlign: "center" },
  filterTextActive: { color: "#062A31" },
  composer: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  composerTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  input: {
    borderColor: colors.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 112,
    padding: 13,
    textAlignVertical: "top",
  },
  composerFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  count: { color: colors.textTertiary, fontSize: 11 },
  submit: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minWidth: 100,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  submitText: { color: "#062A31", fontSize: 13, fontWeight: "900", textAlign: "center" },
  disabled: { opacity: 0.45 },
  loginCard: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderRadius: 14,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  loginText: { color: colors.textSecondary, flex: 1, fontSize: 12, lineHeight: 18 },
  loginButton: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  loginButtonText: { color: "#062A31", fontSize: 12, fontWeight: "900" },
  error: {
    backgroundColor: colors.orangeSoft,
    borderRadius: 10,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  list: { gap: 10 },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    color: colors.textSecondary,
    padding: 24,
    textAlign: "center",
  },
  comment: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 15,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  commentHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  choice: {
    borderRadius: 999,
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  choiceA: { backgroundColor: colors.cyanSoft, color: colors.cyanStrong },
  choiceB: { backgroundColor: colors.orangeSoft, color: colors.orangeStrong },
  authorBlock: { flex: 1 },
  author: { color: colors.text, fontSize: 13, fontWeight: "800" },
  meta: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  body: { color: colors.text, fontSize: 14, lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionActive: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  actionDislike: { backgroundColor: colors.orangeSoft, borderColor: colors.orange },
  actionText: { color: colors.textSecondary, fontSize: 11, fontWeight: "800" },
  replyComposer: { borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 12 },
  replyInput: {
    borderColor: colors.borderStrong,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    minHeight: 76,
    padding: 11,
    textAlignVertical: "top",
  },
  replyComposerActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  replySubmit: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  replies: { borderLeftColor: colors.borderStrong, borderLeftWidth: 2, gap: 8, paddingLeft: 10 },
  reply: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  loadMore: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 14,
  },
  loadMoreText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  backButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 999,
    paddingVertical: 15,
  },
  backButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: "900" },
});
