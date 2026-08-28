"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WhichShell } from "@/components/layout/which-shell";
import type { MemberPrivateProfile, MemberPrivateVote } from "@/lib/contracts";

import styles from "./member-vote-history-experience.module.css";
import { MemberPointPanel } from "./member-point-panel";

type Screen = "loading" | "guest" | "ready" | "error";

async function readVoteHistory(cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/me?${query}`, { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Vote history read failed");
  return (await response.json()) as MemberPrivateProfile;
}

function resultPercent(vote: MemberPrivateVote, code: "A" | "B") {
  const count = code === "A" ? vote.result.acceptedA : vote.result.acceptedB;
  if (vote.result.displayedTotal === 0) return 0;
  return Math.round((count / vote.result.displayedTotal) * 100);
}

function monthKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(
    new Date(value),
  );
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

export function MemberVoteHistoryExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const next = await readVoteHistory();
      if (!next) {
        setProfile(null);
        setScreen("guest");
        return;
      }
      setProfile(next);
      setScreen("ready");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readVoteHistory()
      .then((next) => {
        if (!active) return;
        if (!next) {
          setProfile(null);
          setScreen("guest");
          return;
        }
        setProfile(next);
        setScreen("ready");
      })
      .catch(() => {
        if (active) setScreen("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, MemberPrivateVote[]>();
    for (const vote of profile?.votes.items ?? []) {
      const key = monthKey(vote.acceptedAt);
      const current = grouped.get(key) ?? [];
      current.push(vote);
      grouped.set(key, current);
    }
    return [...grouped.entries()];
  }, [profile?.votes.items]);

  const loadMore = useCallback(async () => {
    const cursor = profile?.votes.nextCursor;
    if (!profile || !cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const next = await readVoteHistory(cursor);
      if (!next) {
        setProfile(null);
        setScreen("guest");
        return;
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              votes: {
                items: [...current.votes.items, ...next.votes.items],
                nextCursor: next.votes.nextCursor,
              },
            }
          : next,
      );
    } catch {
      setLoadMoreError("이전 투표 기록을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, profile]);

  return (
    <WhichShell
      active="me"
      creationEnabled={creationEnabled}
      aside={screen === "ready" && profile ? <MemberPointPanel /> : undefined}
      preserveAsideOnNarrow={screen === "ready" && Boolean(profile)}
    >
      <div className={styles.page}>
        {screen === "loading" ? (
          <section className={styles.message} aria-busy="true" aria-live="polite">
            <p>VOTE HISTORY</p>
            <h1>내 선택을 정리하는 중</h1>
            <span>최근 기록부터 안전하게 불러오고 있어요.</span>
          </section>
        ) : null}

        {screen === "guest" ? (
          <section className={styles.message}>
            <p>PRIVATE HISTORY</p>
            <h1>로그인하면 전체 투표 기록을 볼 수 있어요.</h1>
            <span>이 목록은 다른 사용자에게 공개되지 않습니다.</span>
            <Link href="/login?returnTo=%2Fme%2Fvotes">로그인 또는 빠른 회원가입</Link>
          </section>
        ) : null}

        {screen === "error" ? (
          <section className={styles.message} role="alert">
            <p>CONNECTION LOST</p>
            <h1>투표 기록을 불러오지 못했어요.</h1>
            <button type="button" onClick={() => void load()}>
              다시 불러오기
            </button>
          </section>
        ) : null}

        {screen === "ready" && profile ? (
          <>
            <header className={styles.hero}>
              <div>
                <p>VOTE HISTORY</p>
                <h1>{profile.member.displayName}님의 선택 기록</h1>
                <span>총 {profile.member.participationCount.toLocaleString("ko-KR")}개의 선택</span>
              </div>
            </header>

            <nav className={styles.profileTabs} aria-label="내 기록 메뉴">
              <Link href="/me">프로필</Link>
              <Link aria-current="page" className={styles.profileTabActive} href="/me/votes">
                투표 기록
              </Link>
              <Link href="/me/moderation">Moderation</Link>
            </nav>

            {groups.length === 0 ? (
              <section className={styles.empty}>
                <h2>아직 연결된 선택이 없어요.</h2>
                <p>첫 질문에 참여하면 선택과 현재 결과가 이곳에 기록됩니다.</p>
                <Link href="/">질문 고르기</Link>
              </section>
            ) : (
              <div className={styles.monthList}>
                {groups.map(([key, votes]) => (
                  <section className={styles.monthGroup} key={key} aria-labelledby={`month-${key}`}>
                    <header>
                      <h2 id={`month-${key}`}>{monthLabel(votes[0]!.acceptedAt)}</h2>
                      <span>{votes.length} votes</span>
                    </header>
                    <div className={styles.timeline}>
                      {votes.map((vote) => {
                        const percentA = resultPercent(vote, "A");
                        const percentB = resultPercent(vote, "B");
                        return (
                          <article className={styles.timelineItem} key={vote.voteId}>
                            <div className={styles.voteCopy}>
                              <div className={styles.voteMeta}>
                                <span>{vote.categoryCode.replaceAll("_", " ")}</span>
                                <time dateTime={vote.acceptedAt}>{dayLabel(vote.acceptedAt)}</time>
                              </div>
                              <h3>{vote.question}</h3>
                              <p>
                                내 선택{" "}
                                <strong>
                                  {vote.choice} · {vote.choiceLabel}
                                </strong>
                              </p>
                            </div>
                            <div
                              className={styles.result}
                              aria-label={`현재 결과 A ${percentA}%, B ${percentB}%`}
                            >
                              <div className={styles.resultLabels}>
                                <span>A {percentA}%</span>
                                <span>B {percentB}%</span>
                              </div>
                              <div className={styles.resultBar} aria-hidden="true">
                                <span style={{ width: `${percentA}%` }} />
                              </div>
                              <small>
                                현재 {vote.result.displayedTotal.toLocaleString("ko-KR")}표
                              </small>
                            </div>
                            <Link
                              href={`/issues/${vote.issueId}`}
                              aria-label={`${vote.question} 최신 결과 보기`}
                            >
                              ↗
                            </Link>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {loadMoreError ? (
              <p className={styles.loadMoreError} role="alert">
                {loadMoreError}
              </p>
            ) : null}
            {profile.votes.nextCursor ? (
              <button
                className={styles.moreButton}
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "기록을 더 불러오는 중…" : "이전 기록 더 보기"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </WhichShell>
  );
}
