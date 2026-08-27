import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { ViewToken } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { RotatingCommentHighlights } from "@/components/comments/rotating-comment-highlights";
import { ChoiceMediaPair, VoteChoiceRow } from "@/components/vote/vote-choice-row";
import type {
  CommentHighlights,
  IssueChoice,
  PublicFeedIssue,
  PublicIssueFeed,
  VoteResponse,
} from "@/contracts";
import { MobileApiError } from "@/lib/mobile-api";
import { guestSubjects, memberSessions, mobileApi } from "@/lib/runtime";
import { subjectStorage } from "@/lib/secure-subject-storage";
import { colors } from "@/theme";

type CardVoteState =
  | { status: "PRE_VOTE" }
  | { status: "SUBMITTING"; choice: IssueChoice; idempotencyKey: string }
  | { status: "ERROR"; choice: IssueChoice; idempotencyKey: string; message: string }
  | { status: "RESULT"; vote: VoteResponse };
type HighlightState =
  { status: "LOADING" } | { status: "READY"; highlights: CommentHighlights } | { status: "ERROR" };

const LAST_FIRST_ISSUE_KEY = "which.mobile.feed.last-first-issue.v1";

export default function FeedScreen() {
  const [issues, setIssues] = useState<PublicFeedIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PublicIssueFeed["ranking"] | null>(null);
  const [cardStates, setCardStates] = useState<Record<string, CardVoteState>>({});
  const [highlightStates, setHighlightStates] = useState<Record<string, HighlightState>>({});
  const analyticsSessionId = useRef(randomUUID());
  const viewedRecommendationRequests = useRef(new Set<string>());
  const viewedIssues = useRef(new Set<string>());
  const recordedMediaLoads = useRef(new Set<string>());
  const decisionStartedAt = useRef(new Map<string, number>());
  const memberSessionToken = useRef<string | null>(null);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<PublicFeedIssue>[] }) => {
      for (const viewable of viewableItems) {
        const issue = viewable.item;
        if (!issue || viewedIssues.current.has(issue.id)) continue;
        viewedIssues.current.add(issue.id);
        decisionStartedAt.current.set(issue.id, Date.now());
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
      }
    },
    [],
  );

  const fetchFeed = useCallback(async () => {
    const subjectId = await guestSubjects.getOrCreate();
    const session = await memberSessions.restore().catch(() => null);
    memberSessionToken.current = session?.token ?? null;
    const previousFirstIssueId = await subjectStorage.getItem(LAST_FIRST_ISSUE_KEY);
    let feed = await mobileApi.loadFeed(
      subjectId,
      12,
      previousFirstIssueId ?? undefined,
      session?.token,
    );
    if (feed.items.length === 0 && previousFirstIssueId) {
      feed = await mobileApi.loadFeed(subjectId, 12, undefined, session?.token);
    }
    const firstIssue = feed.items[0];
    if (firstIssue) await subjectStorage.setItem(LAST_FIRST_ISSUE_KEY, firstIssue.id);
    if (
      firstIssue &&
      feed.ranking.mode === "PERSONALIZED" &&
      !viewedRecommendationRequests.current.has(feed.ranking.requestId)
    ) {
      viewedRecommendationRequests.current.add(feed.ranking.requestId);
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "PERSONALIZED_FEED_VIEW",
          issueId: firstIssue.id,
          issueVersion: firstIssue.version,
          recommendationRequestId: feed.ranking.requestId,
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    return feed;
  }, []);

  const applyFeed = useCallback((feed: PublicIssueFeed) => {
    setIssues(feed.items);
    setRanking(feed.ranking);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        applyFeed(await fetchFeed());
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "피드를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyFeed, fetchFeed],
  );

  useEffect(() => {
    let active = true;
    void fetchFeed()
      .then((feed) => {
        if (active) applyFeed(feed);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "피드를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyFeed, fetchFeed]);

  const loadHighlights = useCallback(async (subjectId: string, issueId: string) => {
    setHighlightStates((current) => ({ ...current, [issueId]: { status: "LOADING" } }));
    try {
      const highlights = await mobileApi.loadCommentHighlights(subjectId, issueId);
      setHighlightStates((current) => ({
        ...current,
        [issueId]: { status: "READY", highlights },
      }));
    } catch {
      setHighlightStates((current) => ({ ...current, [issueId]: { status: "ERROR" } }));
    }
  }, []);

  const submitCardVote = useCallback(
    async (issue: PublicFeedIssue, choice: IssueChoice, idempotencyKey: string) => {
      setCardStates((current) => ({
        ...current,
        [issue.id]: { status: "SUBMITTING", choice, idempotencyKey },
      }));
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "VOTE_SUBMIT",
          issueId: issue.id,
          issueVersion: issue.version,
          quality: {
            durationMs: Math.min(
              1_800_000,
              Math.max(0, Date.now() - (decisionStartedAt.current.get(issue.id) ?? Date.now())),
            ),
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
          idempotencyKey,
        };
        let vote: VoteResponse;
        try {
          vote = await mobileApi.submitGuestVote({
            ...command,
            subjectId,
            sessionToken: memberSessionToken.current ?? undefined,
          });
        } catch (reason) {
          if (
            memberSessionToken.current ||
            !(reason instanceof MobileApiError) ||
            reason.code !== "GUEST_SUBJECT_NOT_FOUND"
          ) {
            throw reason;
          }
          subjectId = await guestSubjects.rotate();
          vote = await mobileApi.submitGuestVote({ ...command, subjectId });
        }
        setCardStates((current) => ({ ...current, [issue.id]: { status: "RESULT", vote } }));
        void loadHighlights(subjectId, issue.id);
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
      } catch {
        setCardStates((current) => ({
          ...current,
          [issue.id]: {
            status: "ERROR",
            choice,
            idempotencyKey,
            message: "선택을 전송하지 못했어요.",
          },
        }));
      }
    },
    [loadHighlights],
  );

  const openIssue = useCallback(
    (issue: PublicFeedIssue) => {
      if (ranking?.mode === "PERSONALIZED") {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "PERSONALIZED_ISSUE_OPEN",
            issueId: issue.id,
            issueVersion: issue.version,
            recommendationRequestId: issue.recommendation.requestId,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      router.push({ pathname: "/issues/[issueId]", params: { issueId: issue.id } });
    },
    [ranking?.mode],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      <FlatList
        data={issues}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.content}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50, minimumViewTime: 500 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.cyanStrong}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text accessibilityRole="header" style={styles.brand}>
                <Text style={styles.brandW}>W</Text>HICH
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/interests")}
                style={({ pressed }) => [styles.interestLink, pressed && styles.pressed]}
              >
                <Text style={styles.interestLinkText}>관심사</Text>
              </Pressable>
            </View>
            <Text style={styles.title}>지금, 어느 쪽인가요?</Text>
            <View style={styles.filters}>
              <View style={styles.filterActive}>
                <Text style={styles.filterActiveText}>
                  {ranking?.mode === "PERSONALIZED" ? "추천" : "둘러보기"}
                </Text>
              </View>
              {ranking?.mode === "PERSONALIZED" ? (
                <View style={styles.filterSoft}>
                  <Text style={styles.filterSoftText}>관심사 기반</Text>
                </View>
              ) : ranking?.reasonCode === "PROFILE_NOT_READY" ? (
                <View style={styles.filterSoft}>
                  <Text style={styles.filterSoftText}>사회·일상 우선</Text>
                </View>
              ) : null}
              <Text style={styles.filterHint}>결과는 투표 후 공개</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>
                {error ?? "지금 참여할 수 있는 질문을 모두 봤어요."}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void load()}
                style={styles.retry}
              >
                <Text style={styles.retryText}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : (
            <FeedSkeleton />
          )
        }
        renderItem={({ item }) => (
          <VoteFeedCard
            issue={item}
            state={cardStates[item.id] ?? { status: "PRE_VOTE" }}
            highlightState={highlightStates[item.id]}
            onChoose={(choice) => {
              const state = cardStates[item.id];
              if (state?.status === "SUBMITTING" || state?.status === "RESULT") return;
              void submitCardVote(item, choice, randomUUID());
            }}
            onRetry={(choice, idempotencyKey) => void submitCardVote(item, choice, idempotencyKey)}
            onReset={() =>
              setCardStates((current) => ({
                ...current,
                [item.id]: { status: "PRE_VOTE" },
              }))
            }
            onOpen={() => openIssue(item)}
            onRetryHighlights={() => {
              void guestSubjects
                .getOrCreate()
                .then((subjectId) => loadHighlights(subjectId, item.id));
            }}
            onMediaLoad={(choice, outcome) => {
              const key = `${item.id}:${choice.id}:${outcome}`;
              if (recordedMediaLoads.current.has(key)) return;
              recordedMediaLoads.current.add(key);
              void mobileApi
                .recordAnalyticsEvent({
                  sessionId: analyticsSessionId.current,
                  eventId: randomUUID(),
                  eventType: "ISSUE_MEDIA_LOAD",
                  issueId: item.id,
                  issueVersion: item.version,
                  quality: {
                    canonicalChoiceId: choice.id,
                    shownPosition: item.choices.findIndex(
                      (candidate) => candidate.id === choice.id,
                    ),
                    mediaMode: item.mediaMode,
                    mediaLoadOutcome: outcome,
                  },
                  occurredAt: new Date().toISOString(),
                })
                .catch(() => undefined);
            }}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      <View style={styles.bottomNav}>
        <View style={styles.bottomNavItemActive}>
          <Text style={styles.bottomNavIconActive}>⌂</Text>
          <Text style={styles.bottomNavTextActive}>홈</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/interests")}
          style={styles.bottomNavItem}
        >
          <Text style={styles.bottomNavIcon}>#</Text>
          <Text style={styles.bottomNavText}>관심사</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/me")}
          style={styles.bottomNavItem}
        >
          <Text style={styles.bottomNavIcon}>◎</Text>
          <Text style={styles.bottomNavText}>내 기록</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function VoteFeedCard({
  issue,
  state,
  highlightState,
  onChoose,
  onRetry,
  onReset,
  onOpen,
  onRetryHighlights,
  onMediaLoad,
}: {
  issue: PublicFeedIssue;
  state: CardVoteState;
  highlightState?: HighlightState;
  onChoose: (choice: IssueChoice) => void;
  onRetry: (choice: IssueChoice, idempotencyKey: string) => void;
  onReset: () => void;
  onOpen: () => void;
  onRetryHighlights: () => void;
  onMediaLoad: (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => void;
}) {
  const choiceA = issue.choices.find((choice) => choice.code === "A");
  const choiceB = issue.choices.find((choice) => choice.code === "B");
  const pending = state.status === "SUBMITTING" || state.status === "ERROR" ? state.choice : null;

  return (
    <View style={styles.card} accessibilityState={{ busy: state.status === "SUBMITTING" }}>
      <View style={styles.cardMeta}>
        <Text style={styles.category}>{issue.categoryCode.replaceAll("_", " ")}</Text>
        <Text style={styles.date}>
          {new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
            new Date(issue.publishedAt),
          )}
        </Text>
      </View>
      <Pressable accessibilityRole="link" onPress={onOpen}>
        <Text style={styles.question}>{issue.question}</Text>
      </Pressable>

      {state.status !== "RESULT" ? (
        <View style={styles.choices}>
          {choiceA ? (
            <VoteChoiceRow
              choice={choiceA}
              selected={pending?.id === choiceA.id}
              pending={state.status === "SUBMITTING" && pending?.id === choiceA.id}
              disabled={state.status === "SUBMITTING"}
              onMediaLoad={(outcome) => onMediaLoad(choiceA, outcome)}
              onPress={onChoose}
            />
          ) : null}
          {choiceB ? (
            <VoteChoiceRow
              choice={choiceB}
              selected={pending?.id === choiceB.id}
              pending={state.status === "SUBMITTING" && pending?.id === choiceB.id}
              disabled={state.status === "SUBMITTING"}
              onMediaLoad={(outcome) => onMediaLoad(choiceB, outcome)}
              onPress={onChoose}
            />
          ) : null}
        </View>
      ) : null}

      {state.status === "SUBMITTING" ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          선택을 안전하게 기록하고 있어요…
        </Text>
      ) : null}

      {state.status === "ERROR" ? (
        <View style={styles.errorCard} accessibilityLiveRegion="assertive">
          <Text style={styles.errorText}>{state.message}</Text>
          <View style={styles.errorActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onRetry(state.choice, state.idempotencyKey)}
              style={styles.errorButton}
            >
              <Text style={styles.errorButtonText}>같은 선택으로 재시도</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onReset} style={styles.errorButton}>
              <Text style={styles.errorButtonText}>선택 다시 하기</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state.status === "RESULT" && choiceA && choiceB ? (
        <View style={styles.resultArea}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {state.vote.outcome === "REJECTED_DUPLICATE"
              ? `처음 선택한 ${state.vote.choice}가 유지되고 있어요.`
              : `${state.vote.choice} 선택이 반영됐어요.`}
          </Text>
          <ChoiceMediaPair choices={[choiceA, choiceB]} onMediaLoad={onMediaLoad} />
          <BalanceResultBar
            aLabel={choiceA.label}
            bLabel={choiceB.label}
            acceptedA={state.vote.result.acceptedA}
            acceptedB={state.vote.result.acceptedB}
            selectedChoice={state.vote.choice}
          />
          <RotatingCommentHighlights
            highlights={highlightState?.status === "READY" ? highlightState.highlights : null}
            loading={highlightState?.status === "LOADING"}
            error={highlightState?.status === "ERROR"}
            onRetry={onRetryHighlights}
            onOpenAll={onOpen}
          />
        </View>
      ) : null}

      <Pressable accessibilityRole="link" onPress={onOpen} style={styles.cardFooter}>
        <Text style={styles.cardFooterHint}>
          {state.status === "RESULT" ? "결과가 공개됐어요" : "결과는 선택 후 공개"}
        </Text>
        <Text style={styles.cardFooterLink}>상세·공유 보기 ↗</Text>
      </Pressable>
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View accessibilityLabel="질문 목록을 불러오는 중입니다." style={styles.skeleton}>
      <View style={styles.skeletonLineShort} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonChoice} />
      <View style={styles.skeletonChoice} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  list: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 14, paddingBottom: 20 },
  header: { gap: 14, paddingBottom: 14, paddingTop: 8 },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  brand: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -1.2 },
  brandW: { color: colors.cyanStrong },
  interestLink: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  interestLinkText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 34 },
  filters: { alignItems: "center", flexDirection: "row", gap: 8 },
  filterActive: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 13,
    justifyContent: "center",
  },
  filterActiveText: { color: "#062A31", fontSize: 12, fontWeight: "900" },
  filterSoft: {
    backgroundColor: colors.cyanSoft,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  filterSoftText: { color: colors.cyanStrong, fontSize: 11, fontWeight: "800" },
  filterHint: { color: colors.textTertiary, flex: 1, fontSize: 10, textAlign: "right" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
    padding: 16,
  },
  cardMeta: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  category: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  date: { color: colors.textTertiary, fontSize: 11, fontWeight: "700" },
  question: { color: colors.text, fontSize: 18, fontWeight: "900", lineHeight: 25 },
  choices: { gap: 9 },
  notice: {
    backgroundColor: colors.cyanSoft,
    borderRadius: 10,
    color: colors.cyanStrong,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    padding: 11,
  },
  resultArea: { gap: 4 },
  errorCard: {
    backgroundColor: colors.orangeSoft,
    borderLeftColor: colors.orange,
    borderLeftWidth: 4,
    gap: 10,
    padding: 12,
  },
  errorText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  errorButton: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 9,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 11,
    justifyContent: "center",
  },
  errorButtonText: { color: colors.text, fontSize: 11, fontWeight: "800" },
  cardFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingTop: 8,
  },
  cardFooterHint: { color: colors.textTertiary, fontSize: 10 },
  cardFooterLink: { color: colors.text, fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  separator: { height: 12 },
  stateCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 18,
    padding: 28,
  },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  retry: {
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 46,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  retryText: { color: "#062A31", fontWeight: "900" },
  skeleton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  skeletonLineShort: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    height: 12,
    width: "28%",
  },
  skeletonLine: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    height: 24,
    width: "82%",
  },
  skeletonChoice: { backgroundColor: colors.surfaceSubtle, borderRadius: 12, height: 52 },
  bottomNav: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 62,
  },
  bottomNavItem: { alignItems: "center", flex: 1, gap: 2, justifyContent: "center", minHeight: 62 },
  bottomNavItemActive: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 62,
  },
  bottomNavIcon: { color: colors.textTertiary, fontSize: 19 },
  bottomNavIconActive: { color: colors.cyanStrong, fontSize: 19 },
  bottomNavText: { color: colors.textSecondary, fontSize: 10, fontWeight: "700" },
  bottomNavTextActive: { color: colors.text, fontSize: 10, fontWeight: "900" },
});
