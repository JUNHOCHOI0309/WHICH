"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { WhichShell } from "@/components/layout/which-shell";
import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { VoteChoiceRow } from "@/components/vote/vote-choice-row";
import {
  ensureGuestSubject,
  loadIssueFeed,
  recordAnalyticsEvent,
  submitGuestVote,
} from "@/features/issues/client";
import type { IssueChoice, PublicFeedIssue, PublicIssueFeed, VoteResponse } from "@/lib/contracts";

import styles from "./feed-experience.module.css";

type FeedScreen = "loading" | "ready" | "empty" | "error";
type CardVoteState =
  | { status: "PRE_VOTE" }
  | { status: "SUBMITTING"; choice: IssueChoice; idempotencyKey: string }
  | { status: "ERROR"; choice: IssueChoice; idempotencyKey: string; message: string }
  | { status: "RESULT"; vote: VoteResponse };

export function FeedExperience() {
  const [screen, setScreen] = useState<FeedScreen>("loading");
  const [items, setItems] = useState<PublicFeedIssue[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PublicIssueFeed["ranking"] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cardStates, setCardStates] = useState<Record<string, CardVoteState>>({});
  const viewedRecommendationRequests = useRef(new Set<string>());

  const applyFeed = useCallback((feed: PublicIssueFeed) => {
    setItems(feed.items);
    setNextCursor(feed.nextCursor);
    setRanking(feed.ranking);
    setScreen(feed.items.length ? "ready" : "empty");
  }, []);

  const loadInitial = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureGuestSubject();
      applyFeed(await loadIssueFeed({ limit: 6 }));
    } catch {
      setScreen("error");
    }
  }, [applyFeed]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void ensureGuestSubject()
      .then(() => loadIssueFeed({ limit: 6, signal: controller.signal }))
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
      }).catch(() => undefined);

      try {
        const vote = await submitGuestVote({
          issueId: issue.id,
          issueVersion: issue.version,
          choiceId: choice.id,
          idempotencyKey,
        });
        sessionStorage.setItem(`which:vote-result:${issue.id}`, JSON.stringify(vote));
        setCardStates((current) => ({ ...current, [issue.id]: { status: "RESULT", vote } }));
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
    [],
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

  return (
    <WhichShell active="home">
      <section className={styles.feed} aria-labelledby="feed-title">
        <header className={styles.feedHeader}>
          <div>
            <p className={styles.eyebrow}>TODAY&apos;S CHOICES</p>
            <h1 id="feed-title">지금, 어느 쪽인가요?</h1>
          </div>
          {screen === "ready" ? <span>{items.length}개의 질문</span> : null}
        </header>

        <div className={styles.filters} aria-label="현재 피드 정렬">
          <span className={styles.filterActive}>
            {ranking?.mode === "PERSONALIZED" ? "추천" : "최신"}
          </span>
          {ranking?.mode === "PERSONALIZED" ? (
            <span className={styles.personalizedBadge}>관심사 기반</span>
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
                  onChoose={(choice) => choose(item, choice)}
                  onRetry={(choice, key) => void submitCardVote(item, choice, key)}
                  onReset={() =>
                    setCardStates((current) => ({
                      ...current,
                      [item.id]: { status: "PRE_VOTE" },
                    }))
                  }
                  onOpen={() => recordOpen(item)}
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
    </WhichShell>
  );
}

function FeedCard({
  issue,
  state,
  onChoose,
  onRetry,
  onReset,
  onOpen,
}: {
  issue: PublicFeedIssue;
  state: CardVoteState;
  onChoose: (choice: IssueChoice) => void;
  onRetry: (choice: IssueChoice, idempotencyKey: string) => void;
  onReset: () => void;
  onOpen: () => void;
}) {
  const choiceA = issue.choices.find((choice) => choice.code === "A");
  const choiceB = issue.choices.find((choice) => choice.code === "B");
  const pendingChoice =
    state.status === "SUBMITTING" || state.status === "ERROR" ? state.choice : null;

  return (
    <article className={styles.card} aria-busy={state.status === "SUBMITTING"}>
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
              onSelect={onChoose}
            />
          ) : null}
          {choiceB ? (
            <VoteChoiceRow
              choice={choiceB}
              selected={pendingChoice?.id === choiceB.id}
              pending={state.status === "SUBMITTING" && pendingChoice?.id === choiceB.id}
              disabled={state.status === "SUBMITTING"}
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
          <BalanceResultBar
            aLabel={choiceA.label}
            bLabel={choiceB.label}
            acceptedA={state.vote.result.acceptedA}
            acceptedB={state.vote.result.acceptedB}
            selectedChoice={state.vote.choice}
            compact
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
