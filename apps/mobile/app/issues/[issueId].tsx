import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { PointFeedbackToast, type PointFeedback } from "@/components/points/point-feedback-toast";
import { ChoiceMediaPair, VoteChoiceRow } from "@/components/vote/vote-choice-row";
import type { IssueChoice, MemberPointShopView, PublicIssue, VoteResponse } from "@/contracts";
import { IssueCommentsPanel } from "@/features/comments/issue-comments-panel";
import { InterestSelector } from "@/features/interests/interest-selector";
import { readRememberedMemberVote } from "@/lib/member-vote-cache";
import { MobileApiError } from "@/lib/mobile-api";
import { equippedShopItem, shareBackgroundStyle } from "@/lib/point-shop-cosmetics";
import { guestSubjects, memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

export default function IssueScreen() {
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const rememberedVote = useMemo(() => readRememberedMemberVote(issueId), [issueId]);
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [vote, setVote] = useState<VoteResponse | null>(rememberedVote);
  const [memberSessionToken, setMemberSessionToken] = useState<string | null>(null);
  const [shop, setShop] = useState<MemberPointShopView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeChoice, setIncludeChoice] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nextIssueState, setNextIssueState] = useState<"idle" | "loading" | "empty" | "error">(
    "idle",
  );
  const [pointFeedback, setPointFeedback] = useState<PointFeedback | null>(null);
  const dismissPointFeedback = useCallback(() => setPointFeedback(null), []);
  const completedVote = vote?.issueId === issueId ? vote : rememberedVote;
  const attemptKey = useRef(randomUUID());
  const analyticsSessionId = useRef(randomUUID());
  const decisionStartedAt = useRef(0);
  const recordedMediaLoads = useRef(new Set<string>());
  const recordedResultViews = useRef(new Set<string>());
  const recordedNextEvents = useRef(new Set<string>());
  const isAtScrollEnd = useRef(false);
  const scrollMetrics = useRef({ contentHeight: 0, offsetY: 0, viewportHeight: 0 });
  const nextSwipeStart = useRef({ x: 0, y: 0, atEnd: false });

  const updateScrollEnd = useCallback(() => {
    const { contentHeight, offsetY, viewportHeight } = scrollMetrics.current;
    isAtScrollEnd.current =
      contentHeight > 0 && viewportHeight > 0 && contentHeight - (offsetY + viewportHeight) <= 24;
  }, []);

  const fetchIssue = useCallback(async () => {
    if (!issueId) throw new Error("질문 ID가 필요합니다.");
    const subjectId = await guestSubjects.getOrCreate();
    const session = await memberSessions.restore().catch(() => null);
    const [loadedIssue, restoredVote, loadedShop] = await Promise.all([
      mobileApi.loadIssue(issueId, subjectId, session?.token),
      session ? mobileApi.loadMemberVote(session.token, issueId) : Promise.resolve(null),
      session ? mobileApi.loadPointShop(session.token).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      issue: loadedIssue,
      memberSessionToken: session?.token ?? null,
      shop: loadedShop,
      vote: restoredVote,
    };
  }, [issueId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchIssue();
      setIssue(loaded.issue);
      setMemberSessionToken(loaded.memberSessionToken);
      setShop(loaded.shop);
      setVote(loaded.vote ?? rememberedVote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "질문을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [fetchIssue, rememberedVote]);

  useEffect(() => {
    if (!issue) return;
    decisionStartedAt.current = Date.now();
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "ISSUE_VIEWABLE_IMPRESSION",
        issueId: issue.id,
        issueVersion: issue.version,
        quality: { mediaMode: issue.mediaMode },
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }, [issue]);

  const recordMediaLoad = useCallback(
    (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => {
      if (!issue) return;
      const key = `${choice.id}:${outcome}`;
      if (recordedMediaLoads.current.has(key)) return;
      recordedMediaLoads.current.add(key);
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "ISSUE_MEDIA_LOAD",
          issueId: issue.id,
          issueVersion: issue.version,
          quality: {
            canonicalChoiceId: choice.id,
            shownPosition: issue.choices.findIndex((item) => item.id === choice.id),
            mediaMode: issue.mediaMode,
            mediaLoadOutcome: outcome,
          },
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    },
    [issue],
  );

  useEffect(() => {
    let active = true;
    void fetchIssue()
      .then((loaded) => {
        if (active) {
          setIssue(loaded.issue);
          setMemberSessionToken(loaded.memberSessionToken);
          setShop(loaded.shop);
          setVote(loaded.vote ?? rememberedVote);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "질문을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchIssue, rememberedVote]);

  useEffect(() => {
    if (!issue || !completedVote) return;
    const key = `${issue.id}:${completedVote.result.resultVersion}`;
    if (recordedResultViews.current.has(key)) return;
    recordedResultViews.current.add(key);
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "RESULT_VIEW",
        issueId: issue.id,
        issueVersion: issue.version,
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }, [completedVote, issue]);

  async function submit(choice: IssueChoice) {
    if (!issue || submittingChoice || completedVote) return;
    setSubmittingChoice(choice.id);
    setError(null);
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "VOTE_SUBMIT",
        issueId: issue.id,
        issueVersion: issue.version,
        quality: {
          durationMs: Math.min(1_800_000, Math.max(0, Date.now() - decisionStartedAt.current)),
          canonicalChoiceId: choice.id,
          shownPosition: issue.choices.findIndex((item) => item.id === choice.id),
          mediaMode: issue.mediaMode,
        },
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
    try {
      let subjectId = await guestSubjects.getOrCreate();
      const command = {
        issueId: issue.id,
        issueVersion: issue.version,
        choiceId: choice.id,
        idempotencyKey: attemptKey.current,
      };
      try {
        const acceptedVote = await mobileApi.submitGuestVote({
          ...command,
          subjectId,
          sessionToken: memberSessionToken ?? undefined,
        });
        setVote(acceptedVote);
        if (acceptedVote.pointFeedback) setPointFeedback(acceptedVote.pointFeedback);
      } catch (reason) {
        if (
          memberSessionToken ||
          !(reason instanceof MobileApiError) ||
          reason.code !== "GUEST_SUBJECT_NOT_FOUND"
        ) {
          throw reason;
        }
        subjectId = await guestSubjects.rotate();
        setVote(await mobileApi.submitGuestVote({ ...command, subjectId }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "투표를 전송하지 못했습니다.");
    } finally {
      setSubmittingChoice(null);
    }
  }

  const moveNext = useCallback(async () => {
    if (!issue || nextIssueState === "loading") return;
    setNextIssueState("loading");
    try {
      const subjectId = await guestSubjects.getOrCreate();
      const feed = await mobileApi.loadFeed(
        subjectId,
        6,
        issue.id,
        memberSessionToken ?? undefined,
      );
      const nextIssue =
        feed.items.length > 0
          ? feed.items[Math.floor(Math.random() * feed.items.length)]
          : undefined;
      if (!nextIssue) {
        setNextIssueState("empty");
        const eventKey = `NEXT_ISSUE_EXHAUSTED:${issue.id}`;
        if (!recordedNextEvents.current.has(eventKey)) {
          recordedNextEvents.current.add(eventKey);
          void mobileApi
            .recordAnalyticsEvent({
              sessionId: analyticsSessionId.current,
              eventId: randomUUID(),
              eventType: "NEXT_ISSUE_EXHAUSTED",
              issueId: issue.id,
              issueVersion: issue.version,
              occurredAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        }
        return;
      }
      const eventKey = `NEXT_ISSUE_OPEN:${issue.id}`;
      if (!recordedNextEvents.current.has(eventKey)) {
        recordedNextEvents.current.add(eventKey);
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "NEXT_ISSUE_OPEN",
            issueId: issue.id,
            issueVersion: issue.version,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (feed.ranking.mode === "PERSONALIZED") {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "PERSONALIZED_ISSUE_OPEN",
            issueId: nextIssue.id,
            issueVersion: nextIssue.version,
            recommendationRequestId: nextIssue.recommendation.requestId,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      router.replace({ pathname: "/issues/[issueId]", params: { issueId: nextIssue.id } });
      setNextIssueState("idle");
    } catch {
      setNextIssueState("error");
    }
  }, [issue, memberSessionToken, nextIssueState]);

  async function shareResult() {
    if (!issue || !completedVote || sharing) return;
    setSharing(true);
    setError(null);
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "SHARE_OPEN",
        issueId: issue.id,
        issueVersion: issue.version,
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
    try {
      const created = await mobileApi.createResultShareCard({
        issueId: issue.id,
        issueVersion: issue.version,
        resultVersion: completedVote.result.resultVersion,
        channel: "SYSTEM",
        ...(includeChoice ? { sharedChoiceCode: completedVote.choice } : {}),
      });
      const outcome = await Share.share({
        title: issue.question,
        message: `${issue.question}\n${created.url}`,
        url: created.url,
      });
      if (outcome.action === Share.sharedAction) {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "SHARE_COMPLETE",
            issueId: issue.id,
            issueVersion: issue.version,
            shareCardId: created.shareCard.id,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
        if (memberSessionToken) {
          void mobileApi
            .confirmShareReward({
              sessionToken: memberSessionToken,
              shareCardId: created.shareCard.id,
              idempotencyKey: randomUUID(),
            })
            .then((reward) => {
              if (reward.claimed) setPointFeedback({ amount: 10, reasonLabel: "결과 공유" });
            })
            .catch(() => undefined);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공유 링크를 만들지 못했습니다.");
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!issue) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "질문을 찾지 못했습니다."}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const result = completedVote?.result ?? issue.result.tally;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        onContentSizeChange={(_width, height) => {
          scrollMetrics.current.contentHeight = height;
          updateScrollEnd();
        }}
        onLayout={(event) => {
          scrollMetrics.current.viewportHeight = event.nativeEvent.layout.height;
          updateScrollEnd();
        }}
        onScroll={(event) => {
          scrollMetrics.current.offsetY = event.nativeEvent.contentOffset.y;
          scrollMetrics.current.contentHeight = event.nativeEvent.contentSize.height;
          scrollMetrics.current.viewportHeight = event.nativeEvent.layoutMeasurement.height;
          updateScrollEnd();
        }}
        onTouchEnd={(event) => {
          const deltaX = event.nativeEvent.pageX - nextSwipeStart.current.x;
          const deltaY = nextSwipeStart.current.y - event.nativeEvent.pageY;
          if (nextSwipeStart.current.atEnd && deltaY >= 72 && deltaY > Math.abs(deltaX) * 1.25) {
            void moveNext();
          }
        }}
        onTouchStart={(event) => {
          nextSwipeStart.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
            atEnd: isAtScrollEnd.current,
          };
        }}
        scrollEventThrottle={16}
      >
        <Text style={styles.category}>{issue.categoryCode}</Text>
        <Text accessibilityRole="header" style={styles.question}>
          {issue.question}
        </Text>
        {issue.context ? <Text style={styles.context}>{issue.context}</Text> : null}
        {issue.contextMedia ? (
          <Image
            accessibilityLabel={issue.contextMedia.altText}
            resizeMode={issue.contextMedia.cropMode === "CONTAIN" ? "contain" : "cover"}
            source={{ uri: issue.contextMedia.url }}
            style={styles.contextMedia}
          />
        ) : null}

        <View style={styles.choices}>
          {issue.choices.map((choice) => (
            <VoteChoiceRow
              key={choice.id}
              choice={choice}
              disabled={Boolean(submittingChoice || completedVote)}
              pending={submittingChoice === choice.id}
              selected={completedVote?.choice === choice.code}
              onMediaLoad={(outcome) => recordMediaLoad(choice, outcome)}
              onPress={(selected) => void submit(selected)}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <>
            <View style={styles.resultCard}>
              <Text style={styles.resultEyebrow}>
                {completedVote?.outcome === "REJECTED_DUPLICATE"
                  ? "이미 반영된 선택"
                  : "실시간 결과"}
              </Text>
              {completedVote ? (
                <Text style={styles.myVoteNotice}>
                  ✓ 당신은 “
                  {issue.choices.find((choice) => choice.code === completedVote.choice)?.label ??
                    completedVote.choice}
                  ”에 투표했어요.
                </Text>
              ) : null}
              <ChoiceMediaPair choices={issue.choices} onMediaLoad={recordMediaLoad} />
              <BalanceResultBar
                choices={issue.choices}
                result={result}
                selectedChoice={completedVote?.choice ?? "A"}
              />
            </View>
            {completedVote && !memberSessionToken ? (
              <View style={styles.memberLinkCard}>
                <Text style={styles.memberLinkEyebrow}>MEMBER LINK</Text>
                <Text style={styles.memberLinkTitle}>이 선택을 계정에 이어 두세요.</Text>
                <Text style={styles.memberLinkBody}>
                  로그인 뒤 같은 결과 화면으로 돌아오며, 이 선택은 중복 집계 없이 계정에 연결됩니다.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/login",
                      params: { returnTo: `/issues/${issue.id}` },
                    })
                  }
                  style={({ pressed }) => [
                    styles.memberLinkButton,
                    pressed && styles.choicePressed,
                  ]}
                >
                  <Text style={styles.memberLinkButtonText}>로그인하고 결과로 돌아오기 →</Text>
                </Pressable>
              </View>
            ) : null}
            {completedVote ? (
              <View
                style={[
                  styles.shareCard,
                  shareBackgroundStyle(equippedShopItem(shop, "SHARE_BACKGROUND")),
                ]}
              >
                <Text style={styles.shareTitle}>결과 공유</Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: includeChoice }}
                  onPress={() => {
                    setIncludeChoice((current) => !current);
                    void mobileApi
                      .recordAnalyticsEvent({
                        sessionId: analyticsSessionId.current,
                        eventId: randomUUID(),
                        eventType: "SHARE_CHOICE_TOGGLE",
                        issueId: issue.id,
                        issueVersion: issue.version,
                        occurredAt: new Date().toISOString(),
                      })
                      .catch(() => undefined);
                  }}
                  style={styles.shareToggle}
                >
                  <Text style={styles.shareToggleMark}>{includeChoice ? "✓" : "○"}</Text>
                  <Text style={styles.shareToggleText}>
                    내가 고른 {completedVote.choice}도 함께 공개
                  </Text>
                </Pressable>
                <Text style={styles.sharePrivacy}>
                  기본값은 비공개이며 계정 정보는 링크에 포함되지 않아요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={sharing}
                  onPress={() => void shareResult()}
                  style={({ pressed }) => [styles.shareButton, pressed && styles.choicePressed]}
                >
                  <Text style={styles.shareButtonText}>
                    {sharing ? "공유 준비 중…" : "결과 공유하기"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {completedVote ? <IssueCommentsPanel embedded issueId={issue.id} /> : null}
            <InterestSelector
              mode="prompt"
              analyticsContext={{ issueId: issue.id, issueVersion: issue.version }}
            />
          </>
        ) : (
          <Text style={styles.locked}>결과는 투표 후 공개됩니다.</Text>
        )}
        <View accessibilityLabel="아래에서 위로 드래그해 다음 랜덤 질문" style={styles.swipeHint}>
          <Text style={styles.swipeHintArrow}>↑</Text>
          <Text style={styles.swipeHintText}>
            {nextIssueState === "loading"
              ? "다음 질문을 찾는 중…"
              : "아래로 한 번 더 드래그하면 다른 질문으로 넘어가요."}
          </Text>
        </View>
        {nextIssueState === "empty" ? (
          <Text style={styles.nextIssueMessage}>지금 참여할 수 있는 질문을 모두 골랐어요.</Text>
        ) : null}
        {nextIssueState === "error" ? (
          <Text style={styles.error}>다음 질문을 찾지 못했습니다. 다시 시도해 주세요.</Text>
        ) : null}
      </ScrollView>
      <PointFeedbackToast feedback={pointFeedback} onDismiss={dismissPointFeedback} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { gap: 18, padding: 16, paddingBottom: 48 },
  center: {
    alignItems: "center",
    backgroundColor: colors.bg,
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  category: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  question: { color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 35 },
  context: { color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  contextMedia: { backgroundColor: colors.surface, borderRadius: 14, height: 300, width: "100%" },
  choices: { gap: 10, marginTop: 4 },
  choice: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 24,
    flexDirection: "row",
    gap: 14,
    minHeight: 112,
    padding: 22,
  },
  choiceB: { backgroundColor: colors.accent },
  choicePressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  choiceSelected: { borderColor: colors.paper, borderWidth: 3 },
  choiceCode: {
    backgroundColor: colors.ink,
    borderRadius: 18,
    color: colors.paper,
    fontSize: 16,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  choiceLabel: { color: colors.ink, flex: 1, fontSize: 22, fontWeight: "900" },
  choiceArrow: { color: colors.ink, fontSize: 28, fontWeight: "900" },
  error: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  retry: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  retryText: { color: "#062A31", fontWeight: "900" },
  resultCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 18,
    marginTop: 8,
    padding: 22,
  },
  resultEyebrow: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  myVoteNotice: {
    backgroundColor: colors.cyanSoft,
    borderColor: "#B7EAF0",
    borderRadius: 11,
    borderWidth: 1,
    color: colors.cyanStrong,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    padding: 11,
  },
  memberLinkCard: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  memberLinkEyebrow: {
    color: colors.cyanStrong,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  memberLinkTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  memberLinkBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  memberLinkButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  memberLinkButtonText: { color: "#062A31", fontSize: 13, fontWeight: "900" },
  resultRow: { flexDirection: "row", justifyContent: "space-between" },
  resultA: { color: colors.cyan, fontSize: 26, fontWeight: "900" },
  resultB: { color: colors.accent, fontSize: 26, fontWeight: "900" },
  track: { backgroundColor: colors.accent, borderRadius: 999, height: 8, overflow: "hidden" },
  trackA: { backgroundColor: colors.cyan, height: "100%" },
  total: { color: colors.muted, fontSize: 13, textAlign: "right" },
  shareCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  shareTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  shareToggle: { alignItems: "center", flexDirection: "row", gap: 9 },
  shareToggleMark: { color: colors.cyan, fontSize: 20, fontWeight: "900" },
  shareToggleText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  sharePrivacy: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  shareButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 52,
    justifyContent: "center",
  },
  shareButtonText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  swipeHint: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
  },
  swipeHintArrow: { color: colors.cyanStrong, fontSize: 20, fontWeight: "900" },
  swipeHintText: { color: colors.textTertiary, fontSize: 12, fontWeight: "700" },
  nextIssueMessage: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  locked: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
});
