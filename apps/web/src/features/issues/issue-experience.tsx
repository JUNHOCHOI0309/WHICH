"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  CommentReportReason,
  CommentSide,
  IssueChoice,
  PublicComment,
  PublicIssue,
  VoteResponse,
} from "@/lib/contracts";
import { MemberAccess } from "@/features/identity/member-access";
import { loginHref } from "@/lib/auth";

import styles from "./issue-experience.module.css";
import {
  ensureGuestSubject,
  loadIssueComments,
  loadIssueFeed,
  loadPublicIssue,
  reportComment,
  submitMemberComment,
  submitGuestVote,
  toggleHelpfulReaction,
  WebApiError,
} from "./client";

type Screen = "loading" | "ready" | "submitting" | "load-error" | "submit-error" | "result";

type PendingAction = {
  choice: IssueChoice;
  idempotencyKey: string;
};

function savedResultKey(issueId: string) {
  return `which:vote-result:${issueId}`;
}

function readSavedResult(issueId: string) {
  try {
    const value = sessionStorage.getItem(savedResultKey(issueId));
    if (!value) return null;
    const result = JSON.parse(value) as VoteResponse;
    return result.issueId === issueId ? result : null;
  } catch {
    return null;
  }
}

function saveResult(result: VoteResponse) {
  sessionStorage.setItem(savedResultKey(result.issueId), JSON.stringify(result));
}

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

export function IssueExperience({
  issueId,
  naverLoginEnabled = false,
}: {
  issueId: string;
  naverLoginEnabled?: boolean;
}) {
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
      const savedResult = readSavedResult(issueId);
      if (savedResult) setResult(savedResult);
      setScreen(savedResult ? "result" : "ready");
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
        const savedResult = readSavedResult(issueId);
        if (savedResult) setResult(savedResult);
        setScreen(savedResult ? "result" : "ready");
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
        saveResult(vote);
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
    return <ResultScreen issue={issue} result={result} naverLoginEnabled={naverLoginEnabled} />;
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

function ResultScreen({
  issue,
  result,
  naverLoginEnabled,
}: {
  issue: PublicIssue;
  result: VoteResponse;
  naverLoginEnabled: boolean;
}) {
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
        <MemberAccess issueId={issue.id} naverLoginEnabled={naverLoginEnabled} />
        <CommentSection issueId={issue.id} naverLoginEnabled={naverLoginEnabled} />
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

const COMMENT_REPORT_REASONS: Array<{ value: CommentReportReason; label: string }> = [
  { value: "SPAM", label: "스팸 또는 반복 게시" },
  { value: "HARASSMENT", label: "괴롭힘 또는 위협" },
  { value: "HATE_OR_ABUSE", label: "혐오 또는 모욕" },
  { value: "PERSONAL_INFORMATION", label: "개인정보 노출" },
  { value: "OTHER", label: "기타" },
];

function CommentSection({
  issueId,
  naverLoginEnabled,
}: {
  issueId: string;
  naverLoginEnabled: boolean;
}) {
  const [side, setSide] = useState<CommentSide>("ALL");
  const [items, setItems] = useState<PublicComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CommentState>("loading");
  const [draft, setDraft] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [authState, setAuthState] = useState<"loading" | "guest" | "member">("loading");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [showLoginChoices, setShowLoginChoices] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [pendingReactionIds, setPendingReactionIds] = useState<Set<string>>(() => new Set());
  const [reportDraft, setReportDraft] = useState<{
    commentId: string;
    reason: CommentReportReason;
    detail: string;
  } | null>(null);
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedCollapsedIds, setExpandedCollapsedIds] = useState<Set<string>>(() => new Set());
  const pendingCommentKey = useRef<string | null>(null);
  const pendingReportKey = useRef<{ commentId: string; key: string } | null>(null);
  const draftTouched = useRef(false);
  const draftKey = `which:comment-draft:${issueId}`;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (!draftTouched.current) setDraft(sessionStorage.getItem(draftKey) ?? "");
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (draft) sessionStorage.setItem(draftKey, draft);
    else sessionStorage.removeItem(draftKey);
  }, [draft, draftKey, draftReady]);

  useEffect(() => {
    let active = true;
    void fetch("/api/member-session", { cache: "no-store" })
      .then((response) => {
        if (!active) return;
        setAuthState(response.ok ? "member" : "guest");
      })
      .catch(() => {
        if (active) setAuthState("guest");
      });
    return () => {
      active = false;
    };
  }, []);

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

  const publishComment = async () => {
    const normalizedDraft = draft.trim();
    setPostError(null);

    if (Array.from(normalizedDraft).length < 2) {
      setPostError("두 글자 이상 입력해 주세요.");
      return;
    }

    if (authState !== "member") {
      sessionStorage.setItem(draftKey, draft);
      setShowLoginChoices(true);
      return;
    }

    pendingCommentKey.current ??= crypto.randomUUID();
    setPosting(true);
    try {
      const result = await submitMemberComment({
        issueId,
        body: draft,
        idempotencyKey: pendingCommentKey.current,
      });
      if (side === "ALL" || side === result.comment.choice) {
        setItems((current) => [
          result.comment,
          ...current.filter((item) => item.id !== result.comment.id),
        ]);
      }
      setState("ready");
      sessionStorage.removeItem(draftKey);
      draftTouched.current = false;
      setDraft("");
      pendingCommentKey.current = null;
    } catch (error) {
      if (error instanceof WebApiError) {
        if (error.status === 401) {
          setAuthState("guest");
          setPostError("로그인이 만료됐어요. 초안은 보관했으니 다시 로그인해 주세요.");
        } else if (error.code === "VOTE_REQUIRED") {
          setPostError("이 계정에 연결된 유효한 투표가 없어 댓글을 게시할 수 없어요.");
        } else if (error.code === "COMMENT_ALREADY_EXISTS") {
          setPostError("이 안건에는 이미 댓글을 남겼어요.");
        } else if (error.status === 422) {
          setPostError("URL·제어문자·과도한 반복 없이 2~500자로 작성해 주세요.");
        } else {
          setPostError("댓글을 게시하지 못했어요. 같은 내용으로 다시 시도할 수 있어요.");
        }
      } else {
        setPostError("댓글을 게시하지 못했어요. 같은 내용으로 다시 시도할 수 있어요.");
      }
    } finally {
      setPosting(false);
    }
  };

  const toggleReaction = async (comment: PublicComment) => {
    if (pendingReactionIds.has(comment.id)) return;
    const previous = comment.reactions ?? { helpfulCount: 0, viewerReacted: false };
    const optimisticActive = !previous.viewerReacted;
    const optimisticCount = Math.max(0, previous.helpfulCount + (optimisticActive ? 1 : -1));
    setReactionError(null);
    setPendingReactionIds((current) => new Set(current).add(comment.id));
    setItems((current) =>
      current.map((item) =>
        item.id === comment.id
          ? {
              ...item,
              reactions: { helpfulCount: optimisticCount, viewerReacted: optimisticActive },
            }
          : item,
      ),
    );

    try {
      const result = await toggleHelpfulReaction({
        commentId: comment.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setItems((current) =>
        current.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                reactions: {
                  helpfulCount: result.reaction.helpfulCount,
                  viewerReacted: result.reaction.active,
                },
              }
            : item,
        ),
      );
    } catch (error) {
      setItems((current) =>
        current.map((item) => (item.id === comment.id ? { ...item, reactions: previous } : item)),
      );
      setReactionError(
        error instanceof WebApiError && error.code === "VOTE_REQUIRED"
          ? "이 안건의 유효한 투표가 있어야 공감할 수 있어요."
          : "공감 상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setPendingReactionIds((current) => {
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  };

  const submitReport = async () => {
    if (!reportDraft || reportingCommentId) return;
    const detail = reportDraft.detail.trim();
    if (reportDraft.reason === "OTHER" && Array.from(detail).length < 10) {
      setReportError("기타 사유는 10자 이상 설명해 주세요.");
      return;
    }
    if (pendingReportKey.current?.commentId !== reportDraft.commentId) {
      pendingReportKey.current = { commentId: reportDraft.commentId, key: crypto.randomUUID() };
    }
    setReportingCommentId(reportDraft.commentId);
    setReportError(null);
    setReportMessage(null);
    try {
      const result = await reportComment({
        commentId: reportDraft.commentId,
        idempotencyKey: pendingReportKey.current.key,
        reason: reportDraft.reason,
        detail: reportDraft.reason === "OTHER" ? detail : undefined,
      });
      if (result.comment.visibility === "HIDDEN") {
        setItems((current) => current.filter((item) => item.id !== reportDraft.commentId));
      } else {
        setItems((current) =>
          current.map((item) =>
            item.id === reportDraft.commentId
              ? {
                  ...item,
                  visibility: result.comment.visibility as PublicComment["visibility"],
                  reports: { viewerReported: true, canReport: false },
                }
              : item,
          ),
        );
      }
      pendingReportKey.current = null;
      setReportDraft(null);
      setReportMessage(
        result.comment.visibility === "HIDDEN"
          ? "신고가 접수되어 댓글이 검토 전까지 숨겨졌어요."
          : "신고가 접수되었어요. 검토에 반영하겠습니다.",
      );
    } catch (error) {
      if (error instanceof WebApiError) {
        if (error.code === "REPORT_OWN_COMMENT") {
          setReportError("내가 작성한 댓글은 신고할 수 없어요.");
        } else if (error.code === "REPORT_ALREADY_EXISTS") {
          setReportError("이미 신고한 댓글이에요.");
        } else if (error.code === "VOTE_REQUIRED") {
          setReportError("이 안건에 유효한 투표가 있어야 신고할 수 있어요.");
        } else if (error.code === "REPORT_RATE_LIMITED") {
          setReportError("오늘 신고할 수 있는 횟수를 모두 사용했어요.");
        } else {
          setReportError("신고를 접수하지 못했어요. 같은 내용으로 다시 시도해 주세요.");
        }
      } else {
        setReportError("신고를 접수하지 못했어요. 같은 내용으로 다시 시도해 주세요.");
      }
    } finally {
      setReportingCommentId(null);
    }
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

      <form
        id="comment-compose"
        className={styles.commentComposer}
        onSubmit={(event) => {
          event.preventDefault();
          void publishComment();
        }}
      >
        <label htmlFor={`comment-body-${issueId}`}>내 선택 이유</label>
        <textarea
          id={`comment-body-${issueId}`}
          value={draft}
          maxLength={500}
          rows={4}
          placeholder="왜 이 선택을 했는지 짧게 남겨 보세요. 초안은 이 기기에 보관됩니다."
          onChange={(event) => {
            draftTouched.current = true;
            setDraft(event.target.value);
            setPostError(null);
            setShowLoginChoices(false);
          }}
          aria-describedby={`comment-help-${issueId}`}
        />
        <div className={styles.commentComposerFooter}>
          <p id={`comment-help-${issueId}`}>
            {authState === "member"
              ? "투표 선택지는 서버에서 확인해 자동으로 표시합니다."
              : "Guest도 초안을 쓸 수 있고, 게시할 때만 로그인이 필요합니다."}
          </p>
          <span>{Array.from(draft).length}/500</span>
          <button type="submit" disabled={posting || authState === "loading"}>
            {posting ? "게시 중…" : authState === "member" ? "이유 게시" : "로그인하고 게시"}
          </button>
        </div>
        {showLoginChoices ? (
          <div className={styles.commentLoginChoices} aria-label="댓글 게시 로그인 제공자 선택">
            <a href={loginHref("google", `/issues/${issueId}#comment-compose`)}>Google로 로그인</a>
            <a href={loginHref("x", `/issues/${issueId}#comment-compose`)}>X로 로그인</a>
            {naverLoginEnabled ? (
              <a href={loginHref("naver", `/issues/${issueId}#comment-compose`)}>네이버로 로그인</a>
            ) : null}
          </div>
        ) : null}
        {postError ? (
          <p className={styles.commentComposerError} role="alert">
            {postError}
          </p>
        ) : null}
      </form>

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
          {items.map((comment) => {
            const isCollapsed = comment.visibility === "COLLAPSED";
            const isExpanded = expandedCollapsedIds.has(comment.id);
            const reportState = comment.reports ?? {
              viewerReported: false,
              canReport: true,
            };
            const isReporting = reportingCommentId === comment.id;
            return (
              <article
                key={comment.id}
                className={`${styles.commentCard} ${styles[`comment${comment.choice}`]} ${
                  isCollapsed ? styles.commentCollapsed : ""
                }`}
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
                {isCollapsed && !isExpanded ? (
                  <div className={styles.collapsedNotice}>
                    <p>여러 신고가 접수되어 내용을 접어 두었어요.</p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCollapsedIds((current) => new Set(current).add(comment.id))
                      }
                    >
                      내용 확인
                    </button>
                  </div>
                ) : (
                  <p>{comment.body}</p>
                )}
                <footer>
                  {comment.editedAt ? <span>수정됨</span> : null}
                  {comment.threadState === "LOCKED" ? <span>대화 잠김</span> : null}
                  {!isCollapsed ? (
                    <button
                      type="button"
                      className={`${styles.reactionButton} ${
                        comment.reactions?.viewerReacted ? styles.reactionActive : ""
                      }`}
                      aria-pressed={comment.reactions?.viewerReacted ?? false}
                      disabled={pendingReactionIds.has(comment.id)}
                      onClick={() => void toggleReaction(comment)}
                    >
                      <span aria-hidden="true">{comment.reactions?.viewerReacted ? "♥" : "♡"}</span>
                      공감 {comment.reactions?.helpfulCount ?? 0}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.reportButton}
                    disabled={reportState.viewerReported || !reportState.canReport || isReporting}
                    onClick={() => {
                      setReportMessage(null);
                      setReportError(null);
                      setReportDraft({ commentId: comment.id, reason: "SPAM", detail: "" });
                    }}
                  >
                    {reportState.viewerReported ? "신고 완료" : isReporting ? "접수 중…" : "신고"}
                  </button>
                </footer>
                {reportDraft?.commentId === comment.id ? (
                  <form
                    className={styles.reportForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReport();
                    }}
                  >
                    <label htmlFor={`report-reason-${comment.id}`}>신고 사유</label>
                    <select
                      id={`report-reason-${comment.id}`}
                      value={reportDraft.reason}
                      onChange={(event) => {
                        setReportError(null);
                        setReportDraft((current) =>
                          current
                            ? {
                                ...current,
                                reason: event.target.value as CommentReportReason,
                                detail: "",
                              }
                            : current,
                        );
                      }}
                    >
                      {COMMENT_REPORT_REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </select>
                    {reportDraft.reason === "OTHER" ? (
                      <textarea
                        aria-label="기타 신고 사유"
                        value={reportDraft.detail}
                        maxLength={300}
                        rows={3}
                        placeholder="문제가 되는 이유를 10자 이상 적어 주세요."
                        onChange={(event) =>
                          setReportDraft((current) =>
                            current ? { ...current, detail: event.target.value } : current,
                          )
                        }
                      />
                    ) : null}
                    <div>
                      <button type="submit" disabled={isReporting}>
                        {isReporting ? "접수 중…" : "신고 접수"}
                      </button>
                      <button
                        type="button"
                        disabled={isReporting}
                        onClick={() => {
                          pendingReportKey.current = null;
                          setReportDraft(null);
                          setReportError(null);
                        }}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {reactionError ? (
        <p className={styles.reactionError} role="alert">
          {reactionError}
        </p>
      ) : null}

      {reportMessage ? (
        <p className={styles.reportMessage} role="status">
          {reportMessage}
        </p>
      ) : null}
      {reportError ? (
        <p className={styles.reactionError} role="alert">
          {reportError}
        </p>
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
