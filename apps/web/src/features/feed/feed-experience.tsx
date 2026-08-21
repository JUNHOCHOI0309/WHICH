"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureGuestSubject, loadIssueFeed, recordAnalyticsEvent } from "@/features/issues/client";
import type { PublicFeedIssue, PublicIssueFeed } from "@/lib/contracts";

import styles from "./feed-experience.module.css";

type FeedScreen = "loading" | "ready" | "empty" | "error";

export function FeedExperience() {
  const [screen, setScreen] = useState<FeedScreen>("loading");
  const [items, setItems] = useState<PublicFeedIssue[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PublicIssueFeed["ranking"] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const viewedRecommendationRequests = useRef(new Set<string>());

  const loadInitial = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureGuestSubject();
      const feed = await loadIssueFeed({ limit: 6 });
      setItems(feed.items);
      setNextCursor(feed.nextCursor);
      setRanking(feed.ranking);
      setScreen(feed.items.length ? "ready" : "empty");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void ensureGuestSubject()
      .then(() => loadIssueFeed({ limit: 6, signal: controller.signal }))
      .then((feed) => {
        if (!active) return;
        setItems(feed.items);
        setNextCursor(feed.nextCursor);
        setRanking(feed.ranking);
        setScreen(feed.items.length ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setScreen("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="WHICH 홈">
          WHICH<span>.</span>
        </Link>
        <div className={styles.headerActions}>
          <Link className={styles.meLink} href="/me">
            내 기록
          </Link>
          <span className={styles.liveBadge}>LIVE QUESTIONS</span>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>TODAY&apos;S CHOICES</p>
        <h1>오늘, 당신은 어느 쪽인가요?</h1>
        <p>정답 대신 더 가까운 쪽을 고르고, 선택한 뒤에 결과를 확인하세요.</p>
      </section>

      <section className={styles.feed} aria-labelledby="feed-title">
        <div className={styles.feedHeading}>
          <div>
            <h2 id="feed-title">참여 가능한 질문</h2>
            {screen === "ready" && ranking?.mode === "PERSONALIZED" ? (
              <p className={styles.personalizedBadge}>관심사 기반 추천</p>
            ) : null}
          </div>
          {screen === "ready" ? <span>{items.length}개의 질문</span> : null}
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
            title="지금 참여할 질문을 모두 골랐어요."
            description="새로운 질문이 준비되면 이곳에 이어서 표시됩니다."
          />
        ) : null}
        {screen === "ready" ? (
          <>
            <div className={styles.grid}>
              {items.map((item, index) => (
                <FeedCard
                  issue={item}
                  personalized={ranking?.mode === "PERSONALIZED"}
                  priority={index === 0}
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

      <footer className={styles.footer}>
        <span>YOUR CHOICE, CLEARLY.</span>
        <span>CYAN × ORANGE</span>
      </footer>
    </main>
  );
}

function FeedCard({
  issue,
  personalized,
  priority,
}: {
  issue: PublicFeedIssue;
  personalized: boolean;
  priority: boolean;
}) {
  const choiceA = issue.choices.find((choice) => choice.code === "A");
  const choiceB = issue.choices.find((choice) => choice.code === "B");

  return (
    <article className={`${styles.card} ${priority ? styles.featuredCard : ""}`}>
      <div className={styles.cardMeta}>
        <span>{issue.categoryCode.replaceAll("_", " ")}</span>
        <span>RESULTS AFTER VOTE</span>
      </div>
      <h3>{issue.question}</h3>
      <div className={styles.choicePreview} aria-label="선택지 미리보기">
        <span className={styles.choiceA}>A · {choiceA?.label}</span>
        <span className={styles.choiceB}>B · {choiceB?.label}</span>
      </div>
      <Link
        className={styles.cardLink}
        href={`/issues/${issue.id}`}
        onClick={() => {
          if (!personalized) return;
          void recordAnalyticsEvent({
            eventType: "PERSONALIZED_ISSUE_OPEN",
            issueId: issue.id,
            issueVersion: issue.version,
            recommendationRequestId: issue.recommendation.requestId,
          }).catch(() => undefined);
        }}
      >
        이 질문에 참여하기 <span aria-hidden="true">↗</span>
      </Link>
    </article>
  );
}

function FeedLoading() {
  return (
    <div className={styles.loadingGrid} aria-busy="true" aria-live="polite">
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
      <h3>{title}</h3>
      <span>{description}</span>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
