"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import type { CommentHighlights, PublicComment } from "@/lib/contracts";

import styles from "./rotating-comment-highlights.module.css";

const ROTATION_INTERVAL_MS = 6_000;

export function RotatingCommentHighlights({
  highlights,
  loading,
  error,
  detailsHref,
  onRetry,
}: {
  highlights: CommentHighlights | null;
  loading: boolean;
  error: boolean;
  detailsHref: string;
  onRetry: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const titleId = useId();
  const total = Math.max(highlights?.A.length ?? 0, highlights?.B.length ?? 0);
  const safeIndex = total > 0 ? index % total : 0;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const automaticPaused = userPaused || interactionPaused || pageHidden || reducedMotion;
  useEffect(() => {
    if (total <= 1 || automaticPaused) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % total);
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [automaticPaused, total]);

  const rotate = useCallback(
    (direction: -1 | 1) => {
      if (total <= 1) return;
      setIndex((current) => {
        const next = (current + direction + total) % total;
        setAnnouncement(`대표 댓글 ${next + 1}번째 묶음`);
        return next;
      });
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
      <section className={styles.wrap} aria-label="대표 댓글을 불러오는 중" aria-busy="true">
        <div className={styles.loadingLine} />
        <div className={styles.loadingCards}>
          <div />
          <div />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.message} aria-label="대표 댓글">
        <span>대표 댓글을 불러오지 못했어요.</span>
        <button type="button" onClick={onRetry}>
          다시 불러오기
        </button>
      </section>
    );
  }

  if (!highlights) return null;

  return (
    <section
      className={styles.wrap}
      aria-labelledby={titleId}
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setInteractionPaused(false);
        }
      }}
    >
      <header className={styles.header}>
        <div>
          <span>CHOICE VOICES</span>
          <h3 id={titleId}>A·B 대표 댓글</h3>
        </div>
        <Link href={detailsHref}>전체 댓글</Link>
      </header>

      {total === 0 ? (
        <p className={styles.empty}>아직 공개된 대표 댓글이 없어요. 첫 선택 이유를 남겨보세요.</p>
      ) : (
        <>
          <div className={styles.grid}>
            <HighlightCard side="A" comment={comments.A} />
            <HighlightCard side="B" comment={comments.B} />
          </div>
          {total > 1 ? (
            <div className={styles.controls} aria-label="대표 댓글 순환 제어">
              <button type="button" onClick={() => rotate(-1)} aria-label="이전 대표 댓글">
                ←
              </button>
              <span aria-hidden="true">
                {safeIndex + 1} / {total}
              </span>
              {!reducedMotion ? (
                <button
                  type="button"
                  onClick={() => setUserPaused((current) => !current)}
                  aria-pressed={userPaused}
                >
                  {userPaused ? "자동 재생" : "일시정지"}
                </button>
              ) : (
                <span className={styles.reduced}>자동 순환 꺼짐</span>
              )}
              <button type="button" onClick={() => rotate(1)} aria-label="다음 대표 댓글">
                →
              </button>
            </div>
          ) : null}
        </>
      )}
      <span className={styles.srOnly} aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}

function HighlightCard({ side, comment }: { side: "A" | "B"; comment: PublicComment | null }) {
  return (
    <article className={`${styles.comment} ${side === "A" ? styles.commentA : styles.commentB}`}>
      <div className={styles.commentMeta}>
        <strong>{side}</strong>
        {comment ? <span>공감 {comment.reactions.helpfulCount}</span> : null}
      </div>
      {comment ? (
        <>
          <p>{comment.body}</p>
          <span className={styles.author}>{comment.author.displayName}</span>
        </>
      ) : (
        <p className={styles.emptySide}>아직 {side}를 고른 대표 댓글이 없어요.</p>
      )}
    </article>
  );
}
