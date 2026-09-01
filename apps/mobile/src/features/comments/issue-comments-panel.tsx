import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CommentCard } from "@/components/comments/comment-card";
import { toast } from "@/components/feedback/toast";
import type {
  CommentListView,
  ChoiceCode,
  CommentReportReason,
  PublicComment,
  PublicIssue,
  VoteResponse,
} from "@/contracts";
import { guestSubjects, memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

type Side = "ALL" | ChoiceCode;

const reportReasons: { value: CommentReportReason; label: string }[] = [
  { value: "SPAM", label: "스팸·도배" },
  { value: "HARASSMENT", label: "괴롭힘" },
  { value: "HATE_OR_ABUSE", label: "혐오·욕설" },
  { value: "PERSONAL_INFORMATION", label: "개인정보 노출" },
];

export function IssueCommentsPanel({
  issueId,
  embedded = false,
}: {
  issueId: string;
  embedded?: boolean;
}) {
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [vote, setVote] = useState<VoteResponse | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [side, setSide] = useState<Side>("ALL");
  const [view, setView] = useState<CommentListView>("HIGHLIGHT");
  const [cursor, setCursor] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<PublicComment | null>(null);
  const [reportReason, setReportReason] = useState<CommentReportReason>("SPAM");
  const [reportOptionsOpen, setReportOptionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyticsSessionId = useRef(randomUUID());
  const submissionKey = useRef(randomUUID());

  const load = useCallback(
    async (selectedSide: Side = side, selectedView: CommentListView = view) => {
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
            view: selectedView,
          }),
        ]);
        setSubjectId(nextSubjectId);
        setSessionToken(session?.token ?? null);
        setIssue(loadedIssue);
        setVote(loadedVote);
        setComments(page.items);
        setCursor(page.nextCursor);
        setTotalCount(page.totalCount);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "댓글을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [issueId, side, view],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  function selectSide(nextSide: Side) {
    if (nextSide === side || loading) return;
    setSide(nextSide);
  }

  function selectView(nextView: CommentListView) {
    if (nextView === view || loading) return;
    setView(nextView);
  }

  async function loadMore() {
    if (!issueId || !cursor || loadingMore || view !== "NEWEST") return;
    setLoadingMore(true);
    try {
      const page = await mobileApi.loadComments({
        issueId,
        subjectId: subjectId ?? undefined,
        sessionToken: sessionToken ?? undefined,
        side,
        view,
        cursor,
      });
      setComments((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setCursor(page.nextCursor);
      setTotalCount((current) => Math.max(current, page.totalCount));
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
      if (view === "NEWEST" && (side === "ALL" || side === result.comment.choice)) {
        setComments((current) => [result.comment, ...current]);
      }
      setTotalCount((current) => current + 1);
      toast.success("댓글을 게시했습니다.");
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

  async function toggleHelpful(comment: PublicComment) {
    if (busyCommentId) return;
    setBusyCommentId(comment.id);
    setError(null);
    try {
      const result = await mobileApi.toggleCommentReaction({
        commentId: comment.id,
        subjectId: subjectId ?? undefined,
        sessionToken: sessionToken ?? undefined,
        idempotencyKey: randomUUID(),
        code: "HELPFUL",
      });
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                reactions: {
                  helpfulCount: result.reaction.helpfulCount,
                  dislikeCount: result.reaction.dislikeCount,
                  viewerReaction: result.reaction.active ? "HELPFUL" : null,
                },
              }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공감 상태를 변경하지 못했습니다.");
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
          ? current.filter((item) => item.id !== comment.id)
          : current.map((item) =>
              item.id === comment.id
                ? {
                    ...item,
                    visibility,
                    reports: { canReport: false, viewerReported: true },
                  }
                : item,
            ),
      );
      if (visibility === "HIDDEN") setTotalCount((current) => Math.max(0, current - 1));
      toast.success("신고를 접수했습니다.");
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
    setReportTarget(comment);
    setReportReason("SPAM");
    setReportOptionsOpen(false);
  }

  if (loading) {
    return (
      <View style={[styles.center, embedded && styles.embeddedLoading]}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={embedded ? [] : ["left", "right", "bottom"]}
      style={[styles.safeArea, embedded && styles.embeddedSafeArea]}
    >
      <ScrollView
        contentContainerStyle={[styles.content, embedded && styles.embeddedContent]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!embedded}
      >
        <View style={styles.heading}>
          <View style={styles.headingRow}>
            <View>
              <Text style={styles.eyebrow}>CHOICE REASONS</Text>
              <Text accessibilityRole="header" style={styles.title}>
                댓글
              </Text>
            </View>
            <Text style={styles.loadedCount}>댓글 {totalCount}개</Text>
          </View>
          {issue && !embedded ? <Text style={styles.question}>{issue.question}</Text> : null}
        </View>

        {sessionToken ? (
          <View style={styles.composer}>
            <Text style={styles.composerTitle}>내 선택 이유</Text>
            <TextInput
              accessibilityLabel="내 선택 이유"
              maxLength={2000}
              multiline
              onChangeText={setDraft}
              placeholder="왜 이 선택을 했는지 짧게 남겨보세요."
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={draft}
            />
            <View style={styles.composerFooter}>
              <Text style={styles.count}>{Array.from(draft).length}/2000</Text>
              <Pressable
                accessibilityRole="button"
                disabled={!draft.trim() || submitting}
                onPress={() => void submitComment()}
                style={[styles.submit, (!draft.trim() || submitting) && styles.disabled]}
              >
                <Text style={styles.submitText}>{submitting ? "게시 중…" : "게시하기"}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.loginCard}>
            <Text style={styles.loginText}>댓글 작성은 로그인한 Member만 할 수 있어요.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/login",
                  params: {
                    returnTo: embedded ? `/issues/${issueId}` : `/comments/${issueId}`,
                  },
                })
              }
              style={styles.loginButton}
            >
              <Text style={styles.loginButtonText}>로그인하기</Text>
            </Pressable>
          </View>
        )}

        <View accessibilityLabel="댓글 선택지 필터" style={styles.filters}>
          {(["ALL", ...(issue?.choices.map((choice) => choice.code) ?? ["A", "B"])] as Side[]).map(
            (item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: side === item }}
                onPress={() => selectSide(item)}
                style={[styles.filter, side === item && styles.filterActive]}
              >
                {item === "ALL" ? (
                  <Text style={[styles.filterText, side === item && styles.filterTextActive]}>
                    전체
                  </Text>
                ) : (
                  <View style={styles.filterLabel}>
                    <Text
                      style={[
                        styles.filterChoice,
                        item === "A" ? styles.filterChoiceA : styles.filterChoiceB,
                      ]}
                    >
                      {item}
                    </Text>
                    <Text style={[styles.filterText, side === item && styles.filterTextActive]}>
                      의견
                    </Text>
                  </View>
                )}
              </Pressable>
            ),
          )}
        </View>

        <View accessibilityLabel="댓글 정렬" style={styles.sortTabs}>
          {(
            [
              ["HIGHLIGHT", "♡", "인기순"],
              ["NEWEST", "◷", "최신순"],
            ] as const
          ).map(([value, icon, label]) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: view === value }}
              key={value}
              onPress={() => selectView(value)}
              style={[styles.sortTab, view === value && styles.sortTabActive]}
            >
              <Text style={[styles.sortIcon, view === value && styles.sortTextActive]}>{icon}</Text>
              <Text style={[styles.sortText, view === value && styles.sortTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

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
              <CommentCard
                busy={busyCommentId === comment.id}
                comment={comment}
                key={comment.id}
                onHelpful={(item) => void toggleHelpful(item)}
                onMore={openReport}
              />
            ))
          )}
        </View>

        {cursor && view === "NEWEST" ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreText}>{loadingMore ? "불러오는 중…" : "댓글 더 보기"}</Text>
          </Pressable>
        ) : null}

        {vote && !embedded ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>결과로 돌아가기</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => setReportTarget(null)}
        transparent
        visible={Boolean(reportTarget)}
      >
        <View style={styles.reportOverlay}>
          <Pressable
            accessibilityLabel="댓글 신고 닫기"
            accessibilityRole="button"
            onPress={() => setReportTarget(null)}
            style={styles.reportBackdrop}
          />
          <View accessibilityViewIsModal style={styles.reportSheet}>
            <Text style={styles.reportTitle}>댓글 신고</Text>
            <Text style={styles.reportDescription}>가장 가까운 신고 사유를 선택해 주세요.</Text>
            <Text style={styles.reportLabel}>신고 사유</Text>
            <Pressable
              accessibilityLabel="신고 사유 선택"
              accessibilityRole="button"
              accessibilityState={{ expanded: reportOptionsOpen }}
              onPress={() => setReportOptionsOpen((current) => !current)}
              style={styles.reportSelect}
            >
              <Text style={styles.reportSelectText}>
                {reportReasons.find((item) => item.value === reportReason)?.label}
              </Text>
              <Text style={styles.reportSelectArrow}>{reportOptionsOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {reportOptionsOpen ? (
              <View style={styles.reportOptions}>
                {reportReasons.map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: reportReason === item.value }}
                    key={item.value}
                    onPress={() => {
                      setReportReason(item.value);
                      setReportOptionsOpen(false);
                    }}
                    style={[
                      styles.reportOption,
                      reportReason === item.value && styles.reportOptionActive,
                    ]}
                  >
                    <Text style={styles.reportOptionText}>{item.label}</Text>
                    {reportReason === item.value ? (
                      <Text style={styles.reportOptionCheck}>✓</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.reportActions}>
              <Pressable onPress={() => setReportTarget(null)} style={styles.reportCancel}>
                <Text style={styles.reportCancelText}>취소</Text>
              </Pressable>
              <Pressable
                disabled={!reportTarget || Boolean(busyCommentId)}
                onPress={() => {
                  const target = reportTarget;
                  if (!target) return;
                  setReportTarget(null);
                  void report(target, reportReason);
                }}
                style={styles.reportSubmit}
              >
                <Text style={styles.reportSubmitText}>신고 접수</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  embeddedSafeArea: { flex: 0 },
  content: { gap: 14, padding: 16, paddingBottom: 48 },
  embeddedContent: { padding: 0, paddingBottom: 0 },
  center: { alignItems: "center", backgroundColor: colors.bg, flex: 1, justifyContent: "center" },
  embeddedLoading: { flex: 0, minHeight: 180 },
  heading: { gap: 8 },
  headingRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", lineHeight: 33, marginTop: 2 },
  loadedCount: { color: colors.textTertiary, fontSize: 11, fontWeight: "700" },
  question: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  filters: { flexDirection: "row", gap: 8 },
  filter: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  filterActive: { backgroundColor: "#082A54", borderColor: "#082A54" },
  filterLabel: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center" },
  filterChoice: {
    borderRadius: 999,
    fontSize: 10,
    fontWeight: "900",
    height: 20,
    lineHeight: 20,
    overflow: "hidden",
    textAlign: "center",
    width: 20,
  },
  filterChoiceA: { backgroundColor: colors.cyan, color: "#ffffff" },
  filterChoiceB: { backgroundColor: "#C7F21E", color: "#446000" },
  filterText: { color: colors.textSecondary, fontSize: 13, fontWeight: "800", textAlign: "center" },
  filterTextActive: { color: "#ffffff" },
  sortTabs: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  sortTab: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 44,
  },
  sortTabActive: { backgroundColor: "#082A54" },
  sortIcon: { color: colors.textTertiary, fontSize: 15, fontWeight: "900" },
  sortText: { color: colors.textSecondary, fontSize: 13, fontWeight: "900" },
  sortTextActive: { color: "#ffffff" },
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
  reportOverlay: { flex: 1, justifyContent: "center", padding: 24 },
  reportBackdrop: {
    backgroundColor: "rgba(0, 24, 31, 0.58)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  reportSheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    elevation: 12,
    gap: 12,
    padding: 20,
  },
  reportTitle: { color: colors.text, fontSize: 21, fontWeight: "900" },
  reportDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  reportLabel: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 4 },
  reportSelect: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: 14,
  },
  reportSelectText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  reportSelectArrow: { color: colors.textSecondary, fontSize: 11 },
  reportOptions: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  reportOption: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  reportOptionActive: { backgroundColor: colors.cyanSoft },
  reportOptionText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  reportOptionCheck: { color: colors.cyanStrong, fontSize: 15, fontWeight: "900" },
  reportActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  reportCancel: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  reportCancelText: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  reportSubmit: {
    alignItems: "center",
    backgroundColor: colors.orange,
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  reportSubmitText: { color: colors.text, fontSize: 13, fontWeight: "900" },
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
