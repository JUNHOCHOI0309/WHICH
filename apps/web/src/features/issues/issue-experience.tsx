"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  CommentSide,
  IssueChoice,
  PublicComment,
  PublicIssue,
  VoteResponse,
} from "@/lib/contracts";

import styles from "./issue-experience.module.css";
import {
  ensureGuestSubject,
  loadIssueComments,
  loadIssueFeed,
  loadPublicIssue,
  submitGuestVote,
  WebApiError,
} from "./client";

type Screen = "loading" | "ready" | "submitting" | "load-error" | "submit-error" | "result";

type PendingAction = {
  choice: IssueChoice;
  idempotencyKey: string;
};

function loadErrorCopy(error: unknown) {
  if (error instanceof WebApiError) {
    if (error.code === "ISSUE_NOT_FOUND") {
      return {
        eyebrow: "QUESTION NOT FOUND",
        title: "이 질문을 찾을 수 없어요.",
        description: "주소가 정확한지 확인해 주세요.",
      };
    }
    if (error.code === "ISSUE_NOT_AVAILABLE") {
      return {
        eyebrow: "QUESTION PAUSED",
        title: "지금은 참여할 수 없는 질문이에요.",
        description: "질문이 종료되었거나 잠시 검토 중일 수 있어요.",
      };
    }
  }

  return {
    eyebrow: "CONNECTION LOST",
    title: "질문을 불러오지 못했어요.",
    description: "연결 상태를 확인한 뒤 다시 시도해 주세요.",
  };
}

export function IssueExperience({ issueId }: { issueId: string }) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<VoteResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const submissionLocked = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);

    try {
      const [loadedIssue] = await Promise.all([loadPublicIssue(issueId), ensureGuestSubject()]);
      setIssue(loadedIssue);
      setScreen("ready");
    } catch (error) {
      setLoadError(error);
      setScreen("load-error");
    }
  }, [issueId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void Promise.all([loadPublicIssue(issueId, controller.signal), ensureGuestSubject()])
      .then(([loadedIssue]) => {
        if (!active) return;
        setIssue(loadedIssue);
        setScreen("ready");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setLoadError(error);
        setScreen("load-error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [issueId]);

  const sendPendingVote = useCallback(
    async (action: PendingAction) => {
      if (!issue || submissionLocked.current) return;

      submissionLocked.current = true;
      setSubmitError(null);
      setScreen("submitting");

      try {
        const vote = await submitGuestVote({
          issueId: issue.id,
          issueVersion: issue.version,
          choiceId: action.choice.id,
          idempotencyKey: action.idempotencyKey,
        });
        setResult(vote);
        setPendingAction(null);
        setScreen("result");
      } catch {
        setSubmitError("선택을 전송하지 못했어요. 같은 선택으로 다시 시도할 수 있어요.");
        setScreen("submit-error");
      } finally {
        submissionLocked.current = false;
      }
    },
    [issue],
  );

  const choose = useCallback(
    (choice: IssueChoice) => {
      if (submissionLocked.current || screen !== "ready") return;
      const action = { choice, idempotencyKey: crypto.randomUUID() };
      setPendingAction(action);
      void sendPendingVote(action);
    },
    [screen, sendPendingVote],
  );

  if (screen === "loading") {
    return (
      <ExperienceShell>
        <section className={styles.loadingCard} aria-busy="true" aria-live="polite">
          <span className={styles.pulseDot} />
          <p className={styles.loadingLabel}>질문을 고르는 중</p>
          <div className={styles.skeletonWide} />
          <div className={styles.skeletonShort} />
        </section>
      </ExperienceShell>
    );
  }

  if (screen === "load-error") {
    const copy = loadErrorCopy(loadError);
    return (
      <ExperienceShell>
        <section className={styles.messageCard} aria-live="assertive">
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className={styles.description}>{copy.description}</p>
          <button className={styles.primaryAction} type="button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </section>
      </ExperienceShell>
    );
  }

  if (!issue) return null;

  if (screen === "result" && result) {
    return <ResultScreen issue={issue} result={result} />;
  }

  const selectedChoice = pendingAction?.choice;

  return (
    <ExperienceShell>
      <article className={styles.issueCard} aria-labelledby="issue-question">
        <div className={styles.issueMeta}>
          <span>{issue.categoryCode.replaceAll("_", " ")}</span>
          <span aria-hidden="true">•</span>
          <span>한 번만 선택할 수 있어요</span>
        </div>
        <h1 id="issue-question" className={styles.question}>
          {issue.question}
        </h1>
        {issue.context ? <p className={styles.context}>{issue.context}</p> : null}

        <div className={styles.choiceGrid} aria-label="선택지">
          {issue.choices.map((choice) => (
            <button
              className={`${styles.choiceButton} ${styles[`choice${choice.code}`]} ${
                selectedChoice?.id === choice.id ? styles.choiceSelected : ""
              }`}
              type="button"
              key={choice.id}
              disabled={screen === "submitting" || screen === "submit-error"}
              onClick={() => choose(choice)}
              aria-label={`${choice.code}, ${choice.label}`}
            >
              <span className={styles.choiceCode}>{choice.code}</span>
              <span className={styles.choiceLabel}>{choice.label}</span>
              <span className={styles.choiceArrow} aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>

        {screen === "submitting" ? (
          <p className={styles.inlineStatus} role="status">
            선택을 안전하게 기록하고 있어요…
          </p>
        ) : null}

        {screen === "submit-error" ? (
          <div className={styles.submitError} role="alert">
            <p>{submitError}</p>
            <div className={styles.errorActions}>
              <button
                type="button"
                className={styles.primaryAction}
                onClick={() => {
                  if (pendingAction) void sendPendingVote(pendingAction);
                }}
              >
                같은 선택으로 재시도
              </button>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => {
                  setPendingAction(null);
                  setSubmitError(null);
                  setScreen("ready");
                }}
              >
                선택 다시 하기
              </button>
            </div>
          </div>
        ) : null}

        <p className={styles.privacyNote}>투표 전에는 다른 사람의 선택 비율을 보여주지 않아요.</p>
      </article>
    </ExperienceShell>
  );
}

function ResultScreen({ issue, result }: { issue: PublicIssue; result: VoteResponse }) {
  const total = result.result.displayedTotal;
  const acceptedAPercent = total === 0 ? 0 : Math.round((result.result.acceptedA / total) * 100);
  const acceptedBPercent = total === 0 ? 0 : 100 - acceptedAPercent;
  const duplicate = result.outcome === "REJECTED_DUPLICATE";

  return (
    <ExperienceShell>
      <article className={styles.resultCard} aria-labelledby="result-title" aria-live="polite">
        <p className={styles.eyebrow}>{duplicate ? "YOUR FIRST CHOICE STAYS" : "VOTE RECORDED"}</p>
        <h1 id="result-title">
          {duplicate ? "이미 참여한 질문이에요." : "당신의 선택이 반영됐어요."}
        </h1>
        <p className={styles.description}>
          {duplicate
            ? "처음 선택이 결과에 그대로 유지됩니다."
            : `${result.choice}를 고른 사람들과 결과를 확인해 보세요.`}
        </p>

        <div className={styles.resultQuestion}>{issue.question}</div>
        <div className={styles.resultRows}>
          <ResultRow
            code="A"
            label={issue.choices.find((choice) => choice.code === "A")?.label ?? "A"}
            count={result.result.acceptedA}
            percent={acceptedAPercent}
            selected={result.choice === "A"}
          />
          <ResultRow
            code="B"
            label={issue.choices.find((choice) => choice.code === "B")?.label ?? "B"}
            count={result.result.acceptedB}
            percent={acceptedBPercent}
            selected={result.choice === "B"}
          />
        </div>
        <p className={styles.totalCount}>현재 유효한 선택 {total.toLocaleString("ko-KR")}개</p>
        <CommentSection issueId={issue.id} />
        <NextIssueAction currentIssueId={issue.id} />
      </article>
    </ExperienceShell>
  );
}

type CommentState = "loading" | "ready" | "empty" | "error" | "loading-more";

const COMMENT_FILTERS: Array<{ side: CommentSide; label: string }> = [
  { side: "ALL", label: "전체" },
  { side: "A", label: "A 선택" },
  { side: "B", label: "B 선택" },
];

function CommentSection({ issueId }: { issueId: string }) {
  const [side, setSide] = useState<CommentSide>("ALL");
  const [items, setItems] = useState<PublicComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CommentState>("loading");

  const loadComments = useCallback(
    async (selectedSide: CommentSide, cursor?: string) => {
      try {
        const page = await loadIssueComments({
          issueId,
          side: selectedSide,
          cursor,
          limit: 10,
        });
        setItems((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setState(page.items.length === 0 && !cursor ? "empty" : "ready");
      } catch {
        setState("error");
      }
    },
    [issueId],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void loadIssueComments({ issueId, side, limit: 10, signal: controller.signal })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setState(page.items.length === 0 ? "empty" : "ready");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setState("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [issueId, side]);

  const selectSide = (selectedSide: CommentSide) => {
    if (selectedSide === side) return;
    setItems([]);
    setNextCursor(null);
    setState("loading");
    setSide(selectedSide);
  };

  return (
    <section className={styles.comments} aria-labelledby="comment-title">
      <div className={styles.commentHeading}>
        <div>
          <p className={styles.commentEyebrow}>CHOICE REASONS</p>
          <h2 id="comment-title">사람들은 이렇게 골랐어요</h2>
        </div>
        <span>최신순</span>
      </div>

      <div className={styles.commentFilters} aria-label="선택 이유 필터">
        {COMMENT_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter.side}
            className={side === filter.side ? styles.commentFilterActive : undefined}
            aria-pressed={side === filter.side}
            onClick={() => selectSide(filter.side)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {state === "loading" ? (
        <div className={styles.commentMessage} role="status">
          선택 이유를 불러오는 중…
        </div>
      ) : null}

      {state === "empty" ? (
        <div className={styles.commentMessage} role="status">
          아직 공개된 선택 이유가 없어요. 결과와 다음 질문은 계속 볼 수 있습니다.
        </div>
      ) : null}

      {state === "error" ? (
        <div className={styles.commentMessage} role="alert">
          <p>선택 이유를 불러오지 못했어요. 결과는 그대로 유지됩니다.</p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              void loadComments(side);
            }}
          >
            댓글만 다시 불러오기
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={styles.commentList}>
          {items.map((comment) => (
            <article
              key={comment.id}
              className={`${styles.commentCard} ${styles[`comment${comment.choice}`]}`}
            >
              <header>
                <span className={styles.commentChoice}>{comment.choice}</span>
                <strong>{comment.author.displayName}</strong>
                <time dateTime={comment.createdAt}>
                  {new Intl.DateTimeFormat("ko-KR", {
                    month: "short",
                    day: "numeric",
                  }).format(new Date(comment.createdAt))}
                </time>
              </header>
              <p>{comment.body}</p>
              <footer>
                {comment.editedAt ? <span>수정됨</span> : null}
                {comment.threadState === "LOCKED" ? <span>대화 잠김</span> : null}
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      {state !== "error" && nextCursor ? (
        <button
          type="button"
          className={styles.loadMoreComments}
          disabled={state === "loading-more"}
          onClick={() => {
            setState("loading-more");
            void loadComments(side, nextCursor);
          }}
        >
          {state === "loading-more" ? "더 불러오는 중…" : "선택 이유 더 보기"}
        </button>
      ) : null}
    </section>
  );
}

function NextIssueAction({ currentIssueId }: { currentIssueId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");

  const moveNext = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const feed = await loadIssueFeed({ limit: 1, excludeIssueId: currentIssueId });
      const nextIssue = feed.items[0];
      if (!nextIssue) {
        setState("empty");
        return;
      }
      router.push(`/issues/${nextIssue.id}`);
    } catch {
      setState("error");
    }
  }, [currentIssueId, router, state]);

  return (
    <div className={styles.nextIssue}>
      <button type="button" disabled={state === "loading"} onClick={() => void moveNext()}>
        {state === "loading" ? "다음 질문을 찾는 중…" : "다음 질문 보기"}
        <span aria-hidden="true">→</span>
      </button>
      {state === "empty" ? <p role="status">지금 참여할 수 있는 질문을 모두 골랐어요.</p> : null}
      {state === "error" ? (
        <p role="alert">다음 질문을 찾지 못했어요. 버튼을 눌러 다시 시도해 주세요.</p>
      ) : null}
    </div>
  );
}

function ResultRow({
  code,
  label,
  count,
  percent,
  selected,
}: {
  code: "A" | "B";
  label: string;
  count: number;
  percent: number;
  selected: boolean;
}) {
  return (
    <div className={`${styles.resultRow} ${selected ? styles.resultSelected : ""}`}>
      <div className={styles.resultLabel}>
        <span className={styles.resultCode}>{code}</span>
        <span>{label}</span>
        {selected ? <span className={styles.myChoice}>나의 선택</span> : null}
      </div>
      <div className={styles.resultNumbers}>
        <strong>{percent}%</strong>
        <span>{count.toLocaleString("ko-KR")}</span>
      </div>
      <div className={styles.resultTrack} aria-hidden="true">
        <span className={styles[`resultFill${code}`]} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ExperienceShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="WHICH 홈">
          WHICH<span className={styles.brandDot}>.</span>
        </Link>
        <span className={styles.openBadge}>OPEN QUESTION</span>
      </header>
      <div className={styles.stage}>{children}</div>
      <footer className={styles.footer}>
        <span>YOUR CHOICE, CLEARLY.</span>
        <span>WHICH · 2026</span>
      </footer>
    </main>
  );
}
