"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { WhichShell } from "@/components/layout/which-shell";
import { RotatingCommentHighlights } from "@/components/comments/rotating-comment-highlights";
import { FloatingTopButton } from "@/components/navigation/floating-top-button";
import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { ChoiceMediaPair, VoteChoiceRow } from "@/components/vote/vote-choice-row";
import {
  ensureGuestSubject,
  loadCommentHighlights,
  loadIssueFeed,
  recordAnalyticsEvent,
  submitGuestVote,
} from "@/features/issues/client";
import type {
  CommentHighlights,
  IssueChoice,
  PublicFeedIssue,
  PublicIssueFeed,
  VoteResponse,
} from "@/lib/contracts";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";

import styles from "./feed-experience.module.css";

type FeedScreen = "loading" | "ready" | "empty" | "error";
type CardVoteState =
  | { status: "PRE_VOTE" }
  | { status: "SUBMITTING"; choice: IssueChoice; idempotencyKey: string }
  | { status: "ERROR"; choice: IssueChoice; idempotencyKey: string; message: string }
  | { status: "RESULT"; vote: VoteResponse };
type HighlightState =
  { status: "LOADING" } | { status: "READY"; highlights: CommentHighlights } | { status: "ERROR" };

const LAST_FIRST_ISSUE_KEY = "which:feed:last-first-issue";

function previousFirstIssueId() {
  try {
    return sessionStorage.getItem(LAST_FIRST_ISSUE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberFirstIssue(feed: PublicIssueFeed) {
  const firstIssue = feed.items[0];
  if (!firstIssue) return;
  try {
    sessionStorage.setItem(LAST_FIRST_ISSUE_KEY, firstIssue.id);
  } catch {
    // The server-side ranking seed still provides refresh diversity when storage is unavailable.
  }
}

async function loadRefreshFeed(signal?: AbortSignal) {
  const excludeIssueId = previousFirstIssueId();
  const feed = await loadIssueFeed({ limit: 6, excludeIssueId, signal });
  if (feed.items.length === 0 && excludeIssueId) {
    return loadIssueFeed({ limit: 6, signal });
  }
  return feed;
}

export function FeedExperience({ creationEnabled = false }: { creationEnabled?: boolean }) {
  const [screen, setScreen] = useState<FeedScreen>("loading");
  const [items, setItems] = useState<PublicFeedIssue[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PublicIssueFeed["ranking"] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cardStates, setCardStates] = useState<Record<string, CardVoteState>>({});
  const [highlightStates, setHighlightStates] = useState<Record<string, HighlightState>>({});
  const viewedRecommendationRequests = useRef(new Set<string>());
  const decisionStartedAt = useRef(new Map<string, number>());
  const recordedMediaLoads = useRef(new Set<string>());

  const applyFeed = useCallback((feed: PublicIssueFeed) => {
    rememberFirstIssue(feed);
    setItems(feed.items);
    setNextCursor(feed.nextCursor);
    setRanking(feed.ranking);
    setScreen(feed.items.length ? "ready" : "empty");
  }, []);

  const loadInitial = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureGuestSubject();
      applyFeed(await loadRefreshFeed());
    } catch {
      setScreen("error");
    }
  }, [applyFeed]);

  const refreshFeed = useCallback(async () => {
    await ensureGuestSubject();
    applyFeed(await loadRefreshFeed());
  }, [applyFeed]);

  const pullToRefresh = usePullToRefresh(refreshFeed);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void ensureGuestSubject()
      .then(() => loadRefreshFeed(controller.signal))
      .then((feed) => {
        if (active) applyFeed(feed);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setScreen("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [applyFeed]);

  useEffect(() => {
    const firstIssue = items[0];
    if (
      !firstIssue ||
      ranking?.mode !== "PERSONALIZED" ||
      viewedRecommendationRequests.current.has(ranking.requestId)
    ) {
      return;
    }
    viewedRecommendationRequests.current.add(ranking.requestId);
    void recordAnalyticsEvent({
      eventType: "PERSONALIZED_FEED_VIEW",
      issueId: firstIssue.id,
      issueVersion: firstIssue.version,
      recommendationRequestId: ranking.requestId,
    }).catch(() => undefined);
  }, [items, ranking]);

  const loadHighlights = useCallback(async (issueId: string) => {
    setHighlightStates((current) => ({ ...current, [issueId]: { status: "LOADING" } }));
    try {
      const highlights = await loadCommentHighlights({ issueId });
      setHighlightStates((current) => ({
        ...current,
        [issueId]: { status: "READY", highlights },
      }));
    } catch {
      setHighlightStates((current) => ({ ...current, [issueId]: { status: "ERROR" } }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const feed = await loadIssueFeed({ cursor: nextCursor, limit: 6 });
      setItems((current) => {
        const merged = new Map(current.map((item) => [item.id, item]));
        for (const item of feed.items) merged.set(item.id, item);
        return [...merged.values()];
      });
      setNextCursor(feed.nextCursor);
      const firstNewIssue = feed.items[0];
      if (
        firstNewIssue &&
        feed.ranking.mode === "PERSONALIZED" &&
        !viewedRecommendationRequests.current.has(feed.ranking.requestId)
      ) {
        viewedRecommendationRequests.current.add(feed.ranking.requestId);
        void recordAnalyticsEvent({
          eventType: "PERSONALIZED_FEED_VIEW",
          issueId: firstNewIssue.id,
          issueVersion: firstNewIssue.version,
          recommendationRequestId: feed.ranking.requestId,
        }).catch(() => undefined);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  const submitCardVote = useCallback(
    async (issue: PublicFeedIssue, choice: IssueChoice, idempotencyKey: string) => {
      setCardStates((current) => ({
        ...current,
        [issue.id]: { status: "SUBMITTING", choice, idempotencyKey },
      }));
      void recordAnalyticsEvent({
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
      });

      try {
        const vote = await submitGuestVote({
          issueId: issue.id,
          issueVersion: issue.version,
          choiceId: choice.id,
          idempotencyKey,
        });
        sessionStorage.setItem(`which:vote-result:${issue.id}`, JSON.stringify(vote));
        setCardStates((current) => ({ ...current, [issue.id]: { status: "RESULT", vote } }));
        void loadHighlights(issue.id);
        void recordAnalyticsEvent({
          eventType: "RESULT_VIEW",
          issueId: issue.id,
          issueVersion: issue.version,
        }).catch(() => undefined);
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

  const choose = useCallback(
    (issue: PublicFeedIssue, choice: IssueChoice) => {
      const current = cardStates[issue.id];
      if (current?.status === "SUBMITTING" || current?.status === "RESULT") return;
      void submitCardVote(issue, choice, crypto.randomUUID());
    },
    [cardStates, submitCardVote],
  );

  const recordOpen = useCallback(
    (issue: PublicFeedIssue) => {
      if (ranking?.mode !== "PERSONALIZED") return;
      void recordAnalyticsEvent({
        eventType: "PERSONALIZED_ISSUE_OPEN",
        issueId: issue.id,
        issueVersion: issue.version,
        recommendationRequestId: issue.recommendation.requestId,
      }).catch(() => undefined);
    },
    [ranking?.mode],
  );

  const recordViewable = useCallback((issue: PublicFeedIssue) => {
    decisionStartedAt.current.set(issue.id, Date.now());
    void recordAnalyticsEvent({
      eventType: "ISSUE_VIEWABLE_IMPRESSION",
      issueId: issue.id,
      issueVersion: issue.version,
      quality: { mediaMode: issue.mediaMode },
    });
  }, []);

  const recordMediaLoad = useCallback(
    (issue: PublicFeedIssue, choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => {
      const key = `${issue.id}:${choice.id}:${outcome}`;
      if (recordedMediaLoads.current.has(key)) return;
      recordedMediaLoads.current.add(key);
      void recordAnalyticsEvent({
        eventType: "ISSUE_MEDIA_LOAD",
        issueId: issue.id,
        issueVersion: issue.version,
        quality: {
          canonicalChoiceId: choice.id,
          shownPosition: issue.choices.findIndex((item) => item.id === choice.id),
          mediaMode: issue.mediaMode,
          mediaLoadOutcome: outcome,
        },
      });
    },
    [],
  );

  return (
    <WhichShell active="home" creationEnabled={creationEnabled}>
      <PullRefreshIndicator distance={pullToRefresh.distance} state={pullToRefresh.state} />
      <section className={styles.feed} aria-labelledby="feed-title">
        <header className={styles.feedHeader}>
          <div>
            <p className={styles.eyebrow}>TODAY&apos;S CHOICES</p>
            <h1 id="feed-title">지금, 어느 쪽인가요?</h1>
          </div>
          <div className={styles.feedActions}>
            {screen === "ready" ? <span>{items.length}개의 질문</span> : null}
          </div>
        </header>

        <div className={styles.filters} aria-label="현재 피드 정렬">
          <span className={styles.filterActive}>
            {ranking?.mode === "PERSONALIZED" ? "추천" : "둘러보기"}
          </span>
          {ranking?.mode === "PERSONALIZED" ? (
            <span className={styles.personalizedBadge}>관심사 기반</span>
          ) : ranking?.reasonCode === "PROFILE_NOT_READY" ? (
            <span className={styles.personalizedBadge}>사회·일상 우선</span>
          ) : null}
          <Link href="/interests">관심사 조정</Link>
        </div>

        {screen === "loading" ? <FeedLoading /> : null}
        {screen === "error" ? (
          <FeedMessage
            eyebrow="CONNECTION LOST"
            title="질문을 불러오지 못했어요."
            description="연결 상태를 확인한 뒤 다시 시도해 주세요."
            action="다시 불러오기"
            onAction={() => void loadInitial()}
          />
        ) : null}
        {screen === "empty" ? (
          <FeedMessage
            eyebrow="YOU'RE ALL CAUGHT UP"
            title="지금 참여할 수 있는 질문을 모두 봤어요."
            description="새로운 질문이 올라오면 다시 확인해 주세요."
          />
        ) : null}
        {screen === "ready" ? (
          <>
            <div className={styles.list}>
              {items.map((item) => (
                <FeedCard
                  issue={item}
                  state={cardStates[item.id] ?? { status: "PRE_VOTE" }}
                  highlightState={highlightStates[item.id]}
                  onChoose={(choice) => choose(item, choice)}
                  onRetry={(choice, key) => void submitCardVote(item, choice, key)}
                  onReset={() =>
                    setCardStates((current) => ({
                      ...current,
                      [item.id]: { status: "PRE_VOTE" },
                    }))
                  }
                  onOpen={() => recordOpen(item)}
                  onViewable={recordViewable}
                  onRetryHighlights={() => void loadHighlights(item.id)}
                  onMediaLoad={(choice, outcome) => recordMediaLoad(item, choice, outcome)}
                  key={item.id}
                />
              ))}
            </div>
            {nextCursor ? (
              <button
                className={styles.moreButton}
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "질문을 더 찾는 중…" : "질문 더 보기"}
              </button>
            ) : null}
          </>
        ) : null}
      </section>
      <FloatingTopButton />
    </WhichShell>
  );
}

function PullRefreshIndicator({
  distance,
  state,
}: {
  distance: number;
  state: ReturnType<typeof usePullToRefresh>["state"];
}) {
  const label =
    state === "READY"
      ? "놓아서 새로고침"
      : state === "REFRESHING"
        ? "새 질문을 불러오는 중"
        : state === "ERROR"
          ? "새로고침하지 못했어요"
          : "당겨서 새로고침";

  return (
    <div
      className={styles.pullRefresh}
      data-state={state}
      style={{ "--pull-distance": `${distance}px` } as React.CSSProperties}
      role="status"
      aria-live="polite"
      aria-hidden={state === "IDLE"}
    >
      <span aria-hidden="true">↓</span>
      {label}
    </div>
  );
}

function FeedCard({
  issue,
  state,
  highlightState,
  onChoose,
  onRetry,
  onReset,
  onOpen,
  onViewable,
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
  onViewable: (issue: PublicFeedIssue) => void;
  onRetryHighlights: () => void;
  onMediaLoad: (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => void;
}) {
  const choiceA = issue.choices.find((choice) => choice.code === "A");
  const choiceB = issue.choices.find((choice) => choice.code === "B");
  const pendingChoice =
    state.status === "SUBMITTING" || state.status === "ERROR" ? state.choice : null;
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || !("IntersectionObserver" in window)) return;
    let timer: number | null = null;
    let recorded = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some(
          (entry) => entry.target === element && entry.intersectionRatio >= 0.5,
        );
        if (visible && timer === null && !recorded) {
          timer = window.setTimeout(() => {
            recorded = true;
            onViewable(issue);
          }, 500);
        } else if (!visible && timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [issue, onViewable]);

  return (
    <article ref={cardRef} className={styles.card} aria-busy={state.status === "SUBMITTING"}>
      <div className={styles.cardMeta}>
        <span>{issue.categoryCode.replaceAll("_", " ")}</span>
        <time dateTime={issue.publishedAt}>
          {new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
            new Date(issue.publishedAt),
          )}
        </time>
      </div>

      <Link className={styles.questionLink} href={`/issues/${issue.id}`} onClick={onOpen}>
        <h2>{issue.question}</h2>
      </Link>

      {state.status !== "RESULT" ? (
        <div className={styles.choiceList}>
          {choiceA ? (
            <VoteChoiceRow
              choice={choiceA}
              selected={pendingChoice?.id === choiceA.id}
              pending={state.status === "SUBMITTING" && pendingChoice?.id === choiceA.id}
              disabled={state.status === "SUBMITTING"}
              onMediaLoad={(outcome) => onMediaLoad(choiceA, outcome)}
              onSelect={onChoose}
            />
          ) : null}
          {choiceB ? (
            <VoteChoiceRow
              choice={choiceB}
              selected={pendingChoice?.id === choiceB.id}
              pending={state.status === "SUBMITTING" && pendingChoice?.id === choiceB.id}
              disabled={state.status === "SUBMITTING"}
              onMediaLoad={(outcome) => onMediaLoad(choiceB, outcome)}
              onSelect={onChoose}
            />
          ) : null}
        </div>
      ) : null}

      {state.status === "SUBMITTING" ? (
        <p className={styles.status} role="status">
          선택을 안전하게 기록하고 있어요…
        </p>
      ) : null}

      {state.status === "ERROR" ? (
        <div className={styles.voteError} role="alert">
          <p>{state.message} 같은 선택으로 다시 시도할 수 있어요.</p>
          <div>
            <button type="button" onClick={() => onRetry(state.choice, state.idempotencyKey)}>
              같은 선택으로 재시도
            </button>
            <button type="button" onClick={onReset}>
              선택 다시 하기
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "RESULT" && choiceA && choiceB ? (
        <div className={styles.cardResult}>
          <p className={styles.voteNotice}>
            {state.vote.outcome === "REJECTED_DUPLICATE"
              ? `처음 선택한 ${state.vote.choice}가 유지되고 있어요.`
              : `${state.vote.choice} 선택이 반영됐어요.`}
          </p>
          <ChoiceMediaPair choices={[choiceA, choiceB]} onMediaLoad={onMediaLoad} />
          <BalanceResultBar
            aLabel={choiceA.label}
            bLabel={choiceB.label}
            acceptedA={state.vote.result.acceptedA}
            acceptedB={state.vote.result.acceptedB}
            selectedChoice={state.vote.choice}
            compact
          />
          <RotatingCommentHighlights
            highlights={highlightState?.status === "READY" ? highlightState.highlights : null}
            loading={highlightState?.status === "LOADING"}
            error={highlightState?.status === "ERROR"}
            detailsHref={`/issues/${issue.id}#comment-title`}
            onRetry={onRetryHighlights}
          />
        </div>
      ) : null}

      <footer className={styles.cardFooter}>
        <span>{state.status === "RESULT" ? "결과가 공개됐어요" : "결과는 선택 후 공개"}</span>
        <Link href={`/issues/${issue.id}`} onClick={onOpen}>
          상세·댓글 보기 <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </article>
  );
}

function FeedLoading() {
  return (
    <div className={styles.loadingList} aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>질문 목록을 불러오는 중입니다.</span>
      <div />
      <div />
    </div>
  );
}

function FeedMessage({
  eyebrow,
  title,
  description,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={styles.message} aria-live="polite">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      <span>{description}</span>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
