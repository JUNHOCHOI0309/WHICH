"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { ChoiceMediaPair, VoteChoiceRow } from "@/components/vote/vote-choice-row";
import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import type {
  CommentReportReason,
  CommentSide,
  CommentSort,
  IssueChoice,
  PublicComment,
  PublicIssue,
  VoteResponse,
} from "@/lib/contracts";
import { loginHref } from "@/lib/auth";

import styles from "./issue-experience.module.css";
import {
  createResultShareCard,
  confirmShareReward,
  deleteMemberComment,
  ensureGuestSubject,
  loadIssueComments,
  loadIssueFeed,
  loadExistingVote,
  loadPublicIssue,
  reportComment,
  recordAnalyticsEvent,
  submitMemberComment,
  submitGuestVote,
  toggleCommentReaction,
  updateMemberComment,
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
  kakaoLoginEnabled = false,
  naverLoginEnabled = false,
}: {
  issueId: string;
  kakaoLoginEnabled?: boolean;
  naverLoginEnabled?: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<VoteResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const submissionLocked = useRef(false);
  const issueCardRef = useRef<HTMLElement | null>(null);
  const decisionStartedAt = useRef(0);
  const recordedMediaLoads = useRef(new Set<string>());

  const recordMediaLoad = useCallback(
    (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => {
      if (!issue) return;
      const key = `${choice.id}:${outcome}`;
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
    [issue],
  );

  useEffect(() => {
    if (issue && screen === "ready") decisionStartedAt.current = Date.now();
  }, [issue, screen]);

  useEffect(() => {
    const element = issueCardRef.current;
    if (!element || !issue || screen !== "ready" || !("IntersectionObserver" in window)) return;
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
            decisionStartedAt.current = Date.now();
            void recordAnalyticsEvent({
              eventType: "ISSUE_VIEWABLE_IMPRESSION",
              issueId: issue.id,
              issueVersion: issue.version,
              quality: { mediaMode: issue.mediaMode },
            }).catch(() => undefined);
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
  }, [issue, screen]);

  const load = useCallback(async () => {
    setLoadError(null);

    try {
      await ensureGuestSubject();
      const loadedIssue = await loadPublicIssue(issueId);
      setIssue(loadedIssue);
      const restoredResult =
        readSavedResult(issueId) ?? (await loadExistingVote(issueId).catch(() => null));
      if (restoredResult) {
        setResult(restoredResult);
        saveResult(restoredResult);
      }
      setScreen(restoredResult ? "result" : "ready");
    } catch (error) {
      setLoadError(error);
      setScreen("load-error");
    }
  }, [issueId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void ensureGuestSubject()
      .then(() => loadPublicIssue(issueId, controller.signal))
      .then(async (loadedIssue) => {
        if (!active) return;
        setIssue(loadedIssue);
        const restoredResult =
          readSavedResult(issueId) ??
          (await loadExistingVote(issueId, controller.signal).catch(() => null));
        if (!active) return;
        if (restoredResult) {
          setResult(restoredResult);
          saveResult(restoredResult);
        }
        setScreen(restoredResult ? "result" : "ready");
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
      void recordAnalyticsEvent({
        eventType: "VOTE_SUBMIT",
        issueId: issue.id,
        issueVersion: issue.version,
        quality: {
          durationMs: Math.min(
            1_800_000,
            Math.max(0, Date.now() - (decisionStartedAt.current || Date.now())),
          ),
          canonicalChoiceId: action.choice.id,
          shownPosition: issue.choices.findIndex((choice) => choice.id === action.choice.id),
          mediaMode: issue.mediaMode,
        },
      });
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
        if (vote.pointFeedback) {
          toast.success(`+${vote.pointFeedback.amount}P · ${vote.pointFeedback.reasonLabel}`);
        }
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
    return (
      <ResultScreen
        issue={issue}
        result={result}
        kakaoLoginEnabled={kakaoLoginEnabled}
        naverLoginEnabled={naverLoginEnabled}
        onMediaLoad={recordMediaLoad}
      />
    );
  }

  const selectedChoice = pendingAction?.choice;

  return (
    <ExperienceShell>
      <article ref={issueCardRef} className={styles.issueCard} aria-labelledby="issue-question">
        <div className={styles.issueMeta}>
          <span>{issue.categoryCode.replaceAll("_", " ")}</span>
          <span aria-hidden="true">•</span>
          <span>한 번만 선택할 수 있어요</span>
        </div>
        <h1 id="issue-question" className={styles.question}>
          {issue.question}
        </h1>
        {issue.context ? <p className={styles.context}>{issue.context}</p> : null}
        {issue.author ? (
          <Link className={styles.authorLink} href={`/user/${issue.author.handle}`}>
            <span aria-hidden="true">
              {issue.author.avatar.kind === "IMAGE" ? (
                <img src={issue.author.avatar.url} alt="" referrerPolicy="no-referrer" />
              ) : (
                issue.author.avatar.initials
              )}
            </span>
            <span>
              <small>QUESTION BY</small>
              <strong>{issue.author.displayName}</strong>
              <em>@{issue.author.handle}</em>
            </span>
          </Link>
        ) : null}

        <div className={styles.choiceGrid} aria-label="선택지">
          {issue.choices.map((choice) => (
            <VoteChoiceRow
              key={choice.id}
              choice={choice}
              disabled={screen === "submitting" || screen === "submit-error"}
              pending={screen === "submitting" && selectedChoice?.id === choice.id}
              selected={selectedChoice?.id === choice.id}
              onMediaLoad={(outcome) => recordMediaLoad(choice, outcome)}
              onSelect={choose}
            />
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
  kakaoLoginEnabled,
  naverLoginEnabled,
  onMediaLoad,
}: {
  issue: PublicIssue;
  result: VoteResponse;
  kakaoLoginEnabled: boolean;
  naverLoginEnabled: boolean;
  onMediaLoad: (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => void;
}) {
  const total = result.result.displayedTotal;
  const duplicate = result.outcome === "REJECTED_DUPLICATE";
  const choiceA = issue.choices.find((choice) => choice.code === "A")?.label ?? "A";
  const choiceB = issue.choices.find((choice) => choice.code === "B")?.label ?? "B";

  useEffect(() => {
    const resultOpenedAt = Date.now();
    void recordAnalyticsEvent({
      eventType: "RESULT_VIEW",
      issueId: issue.id,
      issueVersion: issue.version,
    });
    return () => {
      void recordAnalyticsEvent({
        eventType: "RESULT_DWELL_COMPLETE",
        issueId: issue.id,
        issueVersion: issue.version,
        quality: {
          durationMs: Math.min(1_800_000, Math.max(0, Date.now() - resultOpenedAt)),
        },
      });
    };
  }, [issue.id, issue.version]);

  return (
    <ExperienceShell>
      <article className={styles.resultCard} aria-labelledby="result-title" aria-live="polite">
        <p className={styles.eyebrow}>{duplicate ? "YOUR FIRST CHOICE STAYS" : "VOTE RECORD"}</p>
        <h1 id="result-title">
          {duplicate ? "이미 참여한 질문이에요." : "당신의 선택이 반영됐어요."}
        </h1>
        <p className={styles.description}>
          {duplicate
            ? "처음 선택이 결과에 그대로 유지됩니다."
            : `${result.choice}를 고른 사람들과 결과를 확인해 보세요.`}
        </p>

        <div className={styles.resultQuestion}>{issue.question}</div>
        {issue.author ? (
          <Link className={styles.authorLink} href={`/user/${issue.author.handle}`}>
            <span aria-hidden="true">
              {issue.author.avatar.kind === "IMAGE" ? (
                <img src={issue.author.avatar.url} alt="" referrerPolicy="no-referrer" />
              ) : (
                issue.author.avatar.initials
              )}
            </span>
            <span>
              <small>QUESTION BY</small>
              <strong>{issue.author.displayName}</strong>
              <em>@{issue.author.handle}</em>
            </span>
          </Link>
        ) : null}
        <p className={styles.myVoteNotice}>
          ✓ 당신은 “{result.choice === "A" ? choiceA : choiceB}”에 투표했어요.
        </p>
        <ChoiceMediaPair choices={issue.choices} onMediaLoad={onMediaLoad} />
        <BalanceResultBar
          aLabel={choiceA}
          bLabel={choiceB}
          acceptedA={result.result.acceptedA}
          acceptedB={result.result.acceptedB}
          selectedChoice={result.choice}
        />
        <p className={styles.totalCount}>현재 유효한 선택 {total.toLocaleString("ko-KR")}개</p>
        <ResultSharePanel issue={issue} result={result} />
        <CommentSection
          issueId={issue.id}
          issueVersion={issue.version}
          kakaoLoginEnabled={kakaoLoginEnabled}
          naverLoginEnabled={naverLoginEnabled}
        />
        <NextIssueAutoAdvance currentIssueId={issue.id} currentIssueVersion={issue.version} />
      </article>
    </ExperienceShell>
  );
}

type ResultShareChannel = "SYSTEM" | "X";

function ResultSharePanel({ issue, result }: { issue: PublicIssue; result: VoteResponse }) {
  const [includeChoice, setIncludeChoice] = useState(false);
  const [channel, setChannel] = useState<ResultShareChannel>("SYSTEM");
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<ResultShareChannel | null>(null);

  function openShare(nextChannel: ResultShareChannel) {
    if (expanded && channel === nextChannel) {
      setExpanded(false);
      return;
    }
    setChannel(nextChannel);
    setExpanded(true);
    void recordAnalyticsEvent({
      eventType: "SHARE_OPEN",
      issueId: issue.id,
      issueVersion: issue.version,
    }).catch(() => undefined);
  }

  async function share() {
    if (pending) return;
    setPending(channel);
    try {
      let usedClipboardFallback = false;
      const created = await createResultShareCard({
        issueId: issue.id,
        issueVersion: issue.version,
        resultVersion: result.result.resultVersion,
        channel,
        ...(includeChoice ? { sharedChoiceCode: result.choice } : {}),
      });
      if (channel === "SYSTEM" && navigator.share) {
        await navigator.share({
          title: issue.question,
          text: "WHICH 투표 결과를 확인해 보세요.",
          url: created.url,
        });
      } else if (channel === "X") {
        window.open(
          `https://x.com/intent/post?${new URLSearchParams({ text: issue.question, url: created.url })}`,
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        usedClipboardFallback = true;
        await navigator.clipboard.writeText(created.url);
      }
      void recordAnalyticsEvent({
        eventType: "SHARE_COMPLETE",
        issueId: issue.id,
        issueVersion: issue.version,
        shareCardId: created.shareCard.id,
      }).catch(() => undefined);
      void confirmShareReward(created.shareCard.id)
        .then((claimed) => {
          if (claimed) toast.success("+10P · 결과 공유");
        })
        .catch(() => undefined);
      toast.success(
        channel === "X"
          ? "X 공유 창을 열었어요."
          : usedClipboardFallback
            ? "공유 링크를 복사했어요."
            : "기기 공유 화면을 열었어요.",
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      toast.error("공유 링크를 만들지 못했어요. 결과는 그대로 확인할 수 있습니다.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.resultShareShell} aria-label="결과 공유">
      <div className={styles.shareLaunchers} role="group" aria-label="공유 방법 선택">
        <button
          type="button"
          className={channel === "X" && expanded ? styles.shareLauncherActive : undefined}
          aria-expanded={channel === "X" && expanded}
          aria-controls="result-share-panel"
          onClick={() => openShare("X")}
        >
          <Image
            className={styles.shareIcon}
            src="/icons/x-logo.png"
            alt=""
            width={20}
            height={20}
          />
          X 공유
        </button>
        <button
          type="button"
          className={channel === "SYSTEM" && expanded ? styles.shareLauncherActive : undefined}
          aria-expanded={channel === "SYSTEM" && expanded}
          aria-controls="result-share-panel"
          onClick={() => openShare("SYSTEM")}
        >
          <Image
            className={styles.shareIcon}
            src="/icons/share.png"
            alt=""
            width={20}
            height={20}
          />
          공유하기
        </button>
      </div>

      {expanded ? (
        <div className={styles.resultShare} id="result-share-panel">
          <div className={styles.sharePanelHeading}>
            <div>
              <p className={styles.commentEyebrow}>RESULT SHARE</p>
              <h2>이 결과를 같이 이야기해 보세요.</h2>
            </div>
          </div>
          <label className={styles.shareChoiceToggle}>
            <input
              type="checkbox"
              checked={includeChoice}
              onChange={(event) => {
                setIncludeChoice(event.target.checked);
                void recordAnalyticsEvent({
                  eventType: "SHARE_CHOICE_TOGGLE",
                  issueId: issue.id,
                  issueVersion: issue.version,
                }).catch(() => undefined);
              }}
            />
            내가 고른 {result.choice}도 함께 공개
          </label>
          <p className={styles.sharePrivacy}>
            선택 공개는 기본으로 꺼져 있으며, 공유 링크에는 계정 정보가 들어가지 않아요.
          </p>
          <button
            type="button"
            className={styles.sharePrimaryAction}
            disabled={Boolean(pending)}
            onClick={() => void share()}
          >
            <Image
              className={styles.shareIcon}
              src={channel === "X" ? "/icons/x-logo.png" : "/icons/share.png"}
              alt=""
              width={20}
              height={20}
            />
            {pending ? "공유 링크 만드는 중…" : channel === "X" ? "X에 공유하기" : "결과 공유하기"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

type CommentState = "loading" | "ready" | "empty" | "error" | "loading-more";

function mapCommentTree(
  comments: PublicComment[],
  update: (comment: PublicComment) => PublicComment,
): PublicComment[] {
  return comments.map((comment) => {
    const next = update(comment);
    return { ...next, replies: mapCommentTree(next.replies ?? [], update) };
  });
}

function removeFromCommentTree(comments: PublicComment[], commentId: string): PublicComment[] {
  return comments
    .filter((comment) => comment.id !== commentId)
    .map((comment) => ({
      ...comment,
      replies: removeFromCommentTree(comment.replies ?? [], commentId),
    }));
}

function countCommentTree(comment: PublicComment): number {
  return 1 + (comment.replies ?? []).reduce((total, reply) => total + countCommentTree(reply), 0);
}

function removedCommentCount(comments: PublicComment[], commentId: string): number {
  for (const comment of comments) {
    if (comment.id === commentId) return countCommentTree(comment);
    const nested = removedCommentCount(comment.replies ?? [], commentId);
    if (nested > 0) return nested;
  }
  return 0;
}

function relativeCommentTime(value: string) {
  const timestamp = new Date(value).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 60) return "방금 전";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function CommentAuthorHeader({ comment }: { comment: PublicComment }) {
  const initial = Array.from(comment.author.displayName.trim())[0] ?? "?";
  return (
    <header className={styles.commentAuthorHeader}>
      <span className={styles.commentAvatar} aria-hidden="true">
        {comment.author.avatarUrl ? (
          <Image src={comment.author.avatarUrl} alt="" width={38} height={38} unoptimized />
        ) : (
          initial
        )}
      </span>
      <strong>{comment.author.displayName}</strong>
      <time dateTime={comment.createdAt}>{relativeCommentTime(comment.createdAt)}</time>
      <span className={styles.commentChoice} aria-label={`${comment.choice} 선택`}>
        {comment.choice}
      </span>
    </header>
  );
}

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
  issueVersion,
  kakaoLoginEnabled,
  naverLoginEnabled,
}: {
  issueId: string;
  issueVersion: number;
  kakaoLoginEnabled: boolean;
  naverLoginEnabled: boolean;
}) {
  const [side, setSide] = useState<CommentSide>("ALL");
  const [sort, setSort] = useState<CommentSort>("NEWEST");
  const [items, setItems] = useState<PublicComment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<CommentState>("loading");
  const [draft, setDraft] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [authState, setAuthState] = useState<"loading" | "guest" | "member">("loading");
  const [posting, setPosting] = useState(false);
  const [replyDraft, setReplyDraft] = useState<{ parentCommentId: string; body: string } | null>(
    null,
  );
  const [postingReplyId, setPostingReplyId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [showLoginChoices, setShowLoginChoices] = useState(false);
  const [pendingReactionIds, setPendingReactionIds] = useState<Set<string>>(() => new Set());
  const [reportDraft, setReportDraft] = useState<{
    commentId: string;
    reason: CommentReportReason;
    detail: string;
  } | null>(null);
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ commentId: string; body: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [mutatingCommentId, setMutatingCommentId] = useState<string | null>(null);
  const [commentMutationError, setCommentMutationError] = useState<{
    commentId: string;
    message: string;
  } | null>(null);
  const [expandedCollapsedIds, setExpandedCollapsedIds] = useState<Set<string>>(() => new Set());
  const pendingCommentKey = useRef<string | null>(null);
  const pendingReplyKey = useRef<{ parentCommentId: string; key: string } | null>(null);
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
          sort,
          cursor,
          limit: 10,
        });
        setItems((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setTotalCount(
          page.totalCount ??
            page.items.reduce((total, comment) => total + countCommentTree(comment), 0),
        );
        setState(page.items.length === 0 && !cursor ? "empty" : "ready");
      } catch {
        setState("error");
      }
    },
    [issueId, sort],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void loadIssueComments({ issueId, side, sort, limit: 10, signal: controller.signal })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotalCount(
          page.totalCount ??
            page.items.reduce((total, comment) => total + countCommentTree(comment), 0),
        );
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
  }, [issueId, side, sort]);

  const selectSide = (selectedSide: CommentSide) => {
    if (selectedSide === side) return;
    setItems([]);
    setNextCursor(null);
    setState("loading");
    setSide(selectedSide);
  };

  const selectSort = (selectedSort: CommentSort) => {
    if (selectedSort === sort) return;
    setItems([]);
    setNextCursor(null);
    setState("loading");
    setSort(selectedSort);
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
      setTotalCount((current) => current + 1);
      setState("ready");
      sessionStorage.removeItem(draftKey);
      draftTouched.current = false;
      setDraft("");
      pendingCommentKey.current = null;
      toast.success("댓글을 게시했어요.");
      void recordAnalyticsEvent({
        eventType: "COMMENT_COMPLETE",
        issueId,
        issueVersion,
      });
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

  const publishReply = async () => {
    if (!replyDraft || postingReplyId) return;
    const normalizedDraft = replyDraft.body.trim();
    if (Array.from(normalizedDraft).length < 2) {
      setCommentMutationError({
        commentId: replyDraft.parentCommentId,
        message: "답글을 두 글자 이상 입력해 주세요.",
      });
      return;
    }
    if (authState !== "member") {
      setShowLoginChoices(true);
      document.getElementById("comment-compose")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (pendingReplyKey.current?.parentCommentId !== replyDraft.parentCommentId) {
      pendingReplyKey.current = {
        parentCommentId: replyDraft.parentCommentId,
        key: crypto.randomUUID(),
      };
    }
    setPostingReplyId(replyDraft.parentCommentId);
    setCommentMutationError(null);
    try {
      const result = await submitMemberComment({
        issueId,
        parentCommentId: replyDraft.parentCommentId,
        body: replyDraft.body,
        idempotencyKey: pendingReplyKey.current.key,
      });
      setItems((current) =>
        mapCommentTree(current, (comment) =>
          comment.id === replyDraft.parentCommentId
            ? { ...comment, replies: [...(comment.replies ?? []), result.comment] }
            : comment,
        ),
      );
      setTotalCount((current) => current + 1);
      pendingReplyKey.current = null;
      setReplyDraft(null);
      toast.success("답글을 작성했어요.");
    } catch (error) {
      setCommentMutationError({
        commentId: replyDraft.parentCommentId,
        message:
          error instanceof WebApiError && error.status === 401
            ? "로그인이 만료됐어요. 다시 로그인한 뒤 작성해 주세요."
            : error instanceof WebApiError && error.code === "REPLY_PARENT_UNAVAILABLE"
              ? "지금은 이 댓글에 답글을 작성할 수 없어요."
              : "답글을 작성하지 못했어요. 같은 내용으로 다시 시도할 수 있어요.",
      });
    } finally {
      setPostingReplyId(null);
    }
  };

  const toggleReaction = async (comment: PublicComment, code: "HELPFUL" | "DISLIKE") => {
    if (pendingReactionIds.has(comment.id)) return;
    const previous = comment.reactions ?? {
      helpfulCount: 0,
      dislikeCount: 0,
      viewerReaction: null,
    };
    const optimisticActive = previous.viewerReaction !== code;
    const nextReaction = optimisticActive ? code : null;
    const optimisticHelpfulCount = Math.max(
      0,
      previous.helpfulCount +
        (previous.viewerReaction === "HELPFUL" ? -1 : 0) +
        (nextReaction === "HELPFUL" ? 1 : 0),
    );
    const optimisticDislikeCount = Math.max(
      0,
      previous.dislikeCount +
        (previous.viewerReaction === "DISLIKE" ? -1 : 0) +
        (nextReaction === "DISLIKE" ? 1 : 0),
    );
    setPendingReactionIds((current) => new Set(current).add(comment.id));
    setItems((current) =>
      mapCommentTree(current, (item) =>
        item.id === comment.id
          ? {
              ...item,
              reactions: {
                helpfulCount: optimisticHelpfulCount,
                dislikeCount: optimisticDislikeCount,
                viewerReaction: nextReaction,
              },
            }
          : item,
      ),
    );

    try {
      const result = await toggleCommentReaction({
        commentId: comment.id,
        idempotencyKey: crypto.randomUUID(),
        code,
      });
      setItems((current) =>
        mapCommentTree(current, (item) =>
          item.id === comment.id
            ? {
                ...item,
                reactions: {
                  helpfulCount: result.reaction.helpfulCount,
                  dislikeCount: result.reaction.dislikeCount,
                  viewerReaction: result.reaction.active ? result.reaction.code : null,
                },
              }
            : item,
        ),
      );
    } catch (error) {
      setItems((current) =>
        mapCommentTree(current, (item) =>
          item.id === comment.id ? { ...item, reactions: previous } : item,
        ),
      );
      toast.error(
        error instanceof WebApiError && error.code === "VOTE_REQUIRED"
          ? "이 안건의 유효한 투표가 있어야 반응할 수 있어요."
          : "반응 상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setPendingReactionIds((current) => {
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  };

  const saveCommentEdit = async () => {
    if (!editDraft || mutatingCommentId) return;
    const normalizedBody = editDraft.body.trim();
    if (Array.from(normalizedBody).length < 2) {
      setCommentMutationError({
        commentId: editDraft.commentId,
        message: "두 글자 이상 입력해 주세요.",
      });
      return;
    }

    setMutatingCommentId(editDraft.commentId);
    setCommentMutationError(null);
    try {
      const result = await updateMemberComment({
        commentId: editDraft.commentId,
        body: editDraft.body,
      });
      setItems((current) =>
        mapCommentTree(current, (item) =>
          item.id === result.comment.id
            ? { ...item, body: result.comment.body, editedAt: result.comment.editedAt }
            : item,
        ),
      );
      setEditDraft(null);
      toast.success("댓글을 수정했어요.");
    } catch (error) {
      if (error instanceof WebApiError && error.status === 401) {
        setAuthState("guest");
        setItems((current) =>
          mapCommentTree(current, (item) => ({
            ...item,
            permissions: { canEdit: false, canDelete: false },
          })),
        );
      }
      setCommentMutationError({
        commentId: editDraft.commentId,
        message:
          error instanceof WebApiError && error.status === 401
            ? "로그인이 만료됐어요. 다시 로그인한 뒤 수정해 주세요."
            : error instanceof WebApiError && error.status === 422
              ? "URL·제어문자·과도한 반복 없이 2~500자로 작성해 주세요."
              : error instanceof WebApiError && error.code === "COMMENT_AUTHOR_REQUIRED"
                ? "본인이 작성한 댓글만 수정할 수 있어요."
                : "댓글을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setMutatingCommentId(null);
    }
  };

  const removeOwnComment = async (commentId: string) => {
    if (mutatingCommentId) return;
    setMutatingCommentId(commentId);
    setCommentMutationError(null);
    try {
      await deleteMemberComment(commentId);
      const removedCount = removedCommentCount(items, commentId);
      setItems((current) => {
        const next = removeFromCommentTree(current, commentId);
        if (next.length === 0) setState("empty");
        return next;
      });
      setTotalCount((current) => Math.max(0, current - removedCount));
      setDeleteConfirmId(null);
      setEditDraft(null);
      toast.success("댓글을 삭제했어요.");
    } catch (error) {
      if (error instanceof WebApiError && error.status === 401) {
        setAuthState("guest");
        setItems((current) =>
          mapCommentTree(current, (item) => ({
            ...item,
            permissions: { canEdit: false, canDelete: false },
          })),
        );
      }
      setCommentMutationError({
        commentId,
        message:
          error instanceof WebApiError && error.status === 401
            ? "로그인이 만료됐어요. 다시 로그인한 뒤 삭제해 주세요."
            : error instanceof WebApiError && error.code === "COMMENT_AUTHOR_REQUIRED"
              ? "본인이 작성한 댓글만 삭제할 수 있어요."
              : "댓글을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setMutatingCommentId(null);
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
    try {
      const result = await reportComment({
        commentId: reportDraft.commentId,
        idempotencyKey: pendingReportKey.current.key,
        reason: reportDraft.reason,
        detail: reportDraft.reason === "OTHER" ? detail : undefined,
      });
      if (result.comment.visibility === "HIDDEN") {
        const removedCount = removedCommentCount(items, reportDraft.commentId);
        setItems((current) => removeFromCommentTree(current, reportDraft.commentId));
        setTotalCount((current) => Math.max(0, current - removedCount));
      } else {
        setItems((current) =>
          mapCommentTree(current, (item) =>
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
      void recordAnalyticsEvent({
        eventType: "COMMENT_REPORT_COMPLETE",
        issueId,
        issueVersion,
      });
      toast.success(
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

  const renderReply = (reply: PublicComment) => {
    const reportState = reply.reports ?? { viewerReported: false, canReport: true };
    const permissions = reply.permissions ?? { canEdit: false, canDelete: false };
    const isEditing = editDraft?.commentId === reply.id;
    const isMutating = mutatingCommentId === reply.id;
    const isReporting = reportingCommentId === reply.id;
    return (
      <article
        key={reply.id}
        className={`${styles.commentReply} ${styles[`comment${reply.choice}`]}`}
      >
        <CommentAuthorHeader comment={reply} />
        {isEditing ? (
          <form
            className={styles.commentEditForm}
            onSubmit={(event) => {
              event.preventDefault();
              void saveCommentEdit();
            }}
          >
            <label htmlFor={`comment-edit-${reply.id}`}>답글 수정 내용</label>
            <textarea
              id={`comment-edit-${reply.id}`}
              value={editDraft.body}
              maxLength={500}
              rows={3}
              disabled={isMutating}
              onChange={(event) => setEditDraft({ commentId: reply.id, body: event.target.value })}
            />
            <div className={styles.commentEditFooter}>
              <span>{Array.from(editDraft.body).length}/500</span>
              <button type="submit" disabled={isMutating}>
                {isMutating ? "저장 중…" : "수정 저장"}
              </button>
              <button type="button" disabled={isMutating} onClick={() => setEditDraft(null)}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <p>{reply.body}</p>
        )}
        <footer>
          <div className={styles.commentReactionActions}>
            <button
              type="button"
              className={`${styles.reactionButton} ${
                reply.reactions.viewerReaction === "HELPFUL" ? styles.reactionActive : ""
              }`}
              aria-pressed={reply.reactions.viewerReaction === "HELPFUL"}
              disabled={pendingReactionIds.has(reply.id)}
              onClick={() => void toggleReaction(reply, "HELPFUL")}
            >
              <span aria-hidden="true">♡</span> 공감 {reply.reactions.helpfulCount}
            </button>
            <button
              type="button"
              className={`${styles.reactionButtonSecondary} ${
                reply.reactions.viewerReaction === "DISLIKE" ? styles.reactionDislikeActive : ""
              }`}
              aria-label={`싫어요 ${reply.reactions.dislikeCount}`}
              aria-pressed={reply.reactions.viewerReaction === "DISLIKE"}
              disabled={pendingReactionIds.has(reply.id)}
              onClick={() => void toggleReaction(reply, "DISLIKE")}
            >
              <Image src="/icons/dislike.png" alt="" width={16} height={16} />
              <span>{reply.reactions.dislikeCount}</span>
            </button>
          </div>
          <div className={styles.commentSecondaryActions}>
            {reply.editedAt ? <span>수정됨</span> : null}
            {permissions.canEdit ? (
              <button
                type="button"
                className={styles.commentOwnerButton}
                onClick={() => setEditDraft({ commentId: reply.id, body: reply.body })}
              >
                수정
              </button>
            ) : null}
            {permissions.canDelete ? (
              <button
                type="button"
                className={styles.commentOwnerButton}
                onClick={() => setDeleteConfirmId(reply.id)}
              >
                삭제
              </button>
            ) : null}
            {!permissions.canEdit && !permissions.canDelete ? (
              <button
                type="button"
                className={styles.reportButton}
                disabled={reportState.viewerReported || !reportState.canReport || isReporting}
                onClick={() => setReportDraft({ commentId: reply.id, reason: "SPAM", detail: "" })}
              >
                {reportState.viewerReported ? "신고 완료" : isReporting ? "접수 중…" : "신고"}
              </button>
            ) : null}
          </div>
        </footer>
        {deleteConfirmId === reply.id ? (
          <div className={styles.commentDeleteConfirm} role="alert">
            <p>이 답글을 삭제할까요?</p>
            <div>
              <button
                type="button"
                disabled={isMutating}
                onClick={() => void removeOwnComment(reply.id)}
              >
                {isMutating ? "삭제 중…" : "삭제 확인"}
              </button>
              <button type="button" disabled={isMutating} onClick={() => setDeleteConfirmId(null)}>
                취소
              </button>
            </div>
          </div>
        ) : null}
        {commentMutationError?.commentId === reply.id ? (
          <p className={styles.commentMutationError}>{commentMutationError.message}</p>
        ) : null}
        {reportDraft?.commentId === reply.id ? (
          <form
            className={styles.reportForm}
            onSubmit={(event) => {
              event.preventDefault();
              void submitReport();
            }}
          >
            <label htmlFor={`report-reason-${reply.id}`}>신고 사유</label>
            <select
              id={`report-reason-${reply.id}`}
              value={reportDraft.reason}
              onChange={(event) =>
                setReportDraft((current) =>
                  current
                    ? {
                        ...current,
                        reason: event.target.value as CommentReportReason,
                        detail: "",
                      }
                    : current,
                )
              }
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
              <button type="button" disabled={isReporting} onClick={() => setReportDraft(null)}>
                취소
              </button>
            </div>
          </form>
        ) : null}
      </article>
    );
  };

  return (
    <section className={styles.comments} aria-labelledby="comment-title">
      <div className={styles.commentHeading}>
        <div>
          <p className={styles.commentEyebrow}>CHOICE REASONS</p>
          <h2 id="comment-title">사람들은 이렇게 골랐어요</h2>
        </div>
      </div>

      <div className={styles.commentFilters} aria-label="댓글 필터와 정렬">
        <div className={styles.commentSideFilters} aria-label="선택 이유 필터">
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
        <div className={styles.commentSortFilters} aria-label="댓글 정렬">
          <button
            type="button"
            className={sort === "NEWEST" ? styles.commentSortActive : undefined}
            aria-pressed={sort === "NEWEST"}
            onClick={() => selectSort("NEWEST")}
          >
            최신순
          </button>
          <button
            type="button"
            className={sort === "HELPFUL" ? styles.commentSortActive : undefined}
            aria-pressed={sort === "HELPFUL"}
            onClick={() => selectSort("HELPFUL")}
          >
            공감순
          </button>
        </div>
      </div>

      <p className={styles.commentTotal} aria-live="polite">
        전체 댓글 <strong>{totalCount.toLocaleString("ko-KR")}</strong>개
      </p>

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
            {posting ? "작성 중…" : authState === "member" ? "작성" : "로그인하고 작성"}
          </button>
        </div>
        {showLoginChoices ? (
          <div className={styles.commentLoginChoices} aria-label="댓글 게시 로그인 제공자 선택">
            <a href={loginHref("google", `/issues/${issueId}#comment-compose`)}>Google로 로그인</a>
            <a href={loginHref("x", `/issues/${issueId}#comment-compose`)}>X로 로그인</a>
            {naverLoginEnabled ? (
              <a href={loginHref("naver", `/issues/${issueId}#comment-compose`)}>네이버로 로그인</a>
            ) : null}
            {kakaoLoginEnabled ? (
              <a href={loginHref("kakao", `/issues/${issueId}#comment-compose`)}>카카오로 로그인</a>
            ) : null}
          </div>
        ) : null}
        {postError ? (
          <p className={styles.commentComposerError} role="alert">
            {postError}
          </p>
        ) : null}
      </form>

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
            const reactions = comment.reactions ?? {
              helpfulCount: 0,
              dislikeCount: 0,
              viewerReaction: null,
            };
            const replies = comment.replies ?? [];
            const isExpanded = expandedCollapsedIds.has(comment.id);
            const reportState = comment.reports ?? {
              viewerReported: false,
              canReport: true,
            };
            const isReporting = reportingCommentId === comment.id;
            const permissions = comment.permissions ?? { canEdit: false, canDelete: false };
            const isEditing = editDraft?.commentId === comment.id;
            const isMutating = mutatingCommentId === comment.id;
            return (
              <article
                key={comment.id}
                className={`${styles.commentCard} ${styles[`comment${comment.choice}`]} ${
                  isCollapsed ? styles.commentCollapsed : ""
                }`}
              >
                <CommentAuthorHeader comment={comment} />
                {isEditing ? (
                  <form
                    className={styles.commentEditForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveCommentEdit();
                    }}
                  >
                    <label htmlFor={`comment-edit-${comment.id}`}>댓글 수정 내용</label>
                    <textarea
                      id={`comment-edit-${comment.id}`}
                      value={editDraft.body}
                      maxLength={500}
                      rows={4}
                      disabled={isMutating}
                      onChange={(event) => {
                        setCommentMutationError(null);
                        setEditDraft({ commentId: comment.id, body: event.target.value });
                      }}
                    />
                    <div className={styles.commentEditFooter}>
                      <span>{Array.from(editDraft.body).length}/500</span>
                      <button type="submit" disabled={isMutating}>
                        {isMutating ? "저장 중…" : "수정 저장"}
                      </button>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => {
                          setEditDraft(null);
                          setCommentMutationError(null);
                        }}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                ) : isCollapsed && !isExpanded ? (
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
                  {!isCollapsed ? (
                    <div className={styles.commentReactionActions}>
                      <button
                        type="button"
                        className={`${styles.reactionButton} ${
                          reactions.viewerReaction === "HELPFUL" ? styles.reactionActive : ""
                        }`}
                        aria-pressed={reactions.viewerReaction === "HELPFUL"}
                        disabled={pendingReactionIds.has(comment.id)}
                        onClick={() => void toggleReaction(comment, "HELPFUL")}
                      >
                        <span aria-hidden="true">♡</span> 공감 {reactions.helpfulCount}
                      </button>
                      <button
                        type="button"
                        className={`${styles.reactionButtonSecondary} ${
                          reactions.viewerReaction === "DISLIKE" ? styles.reactionDislikeActive : ""
                        }`}
                        aria-label={`싫어요 ${reactions.dislikeCount}`}
                        aria-pressed={reactions.viewerReaction === "DISLIKE"}
                        disabled={pendingReactionIds.has(comment.id)}
                        onClick={() => void toggleReaction(comment, "DISLIKE")}
                      >
                        <Image src="/icons/dislike.png" alt="" width={16} height={16} />
                        <span>{reactions.dislikeCount}</span>
                      </button>
                    </div>
                  ) : null}
                  <div className={styles.commentSecondaryActions}>
                    {comment.editedAt ? <span>수정됨</span> : null}
                    {comment.threadState === "LOCKED" ? <span>대화 잠김</span> : null}
                    {!isCollapsed && comment.threadState === "OPEN" ? (
                      <button
                        type="button"
                        className={styles.replyButton}
                        onClick={() => {
                          setCommentMutationError(null);
                          setReplyDraft({ parentCommentId: comment.id, body: "" });
                        }}
                      >
                        답글
                      </button>
                    ) : null}
                    {permissions.canEdit ? (
                      <button
                        type="button"
                        className={styles.commentOwnerButton}
                        disabled={isMutating}
                        onClick={() => {
                          setDeleteConfirmId(null);
                          setCommentMutationError(null);
                          setEditDraft({ commentId: comment.id, body: comment.body });
                        }}
                      >
                        수정
                      </button>
                    ) : null}
                    {permissions.canDelete ? (
                      <button
                        type="button"
                        className={styles.commentOwnerButton}
                        disabled={isMutating}
                        onClick={() => {
                          setEditDraft(null);
                          setCommentMutationError(null);
                          setDeleteConfirmId(comment.id);
                        }}
                      >
                        삭제
                      </button>
                    ) : null}
                    {!permissions.canEdit && !permissions.canDelete ? (
                      <button
                        type="button"
                        className={styles.reportButton}
                        disabled={
                          reportState.viewerReported || !reportState.canReport || isReporting
                        }
                        onClick={() => {
                          setReportError(null);
                          setReportDraft({ commentId: comment.id, reason: "SPAM", detail: "" });
                        }}
                      >
                        {reportState.viewerReported
                          ? "신고 완료"
                          : isReporting
                            ? "접수 중…"
                            : "신고"}
                      </button>
                    ) : null}
                  </div>
                </footer>
                {deleteConfirmId === comment.id ? (
                  <div className={styles.commentDeleteConfirm} role="alert">
                    <p>이 댓글을 삭제할까요? 삭제한 내용은 다시 표시되지 않아요.</p>
                    <div>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void removeOwnComment(comment.id)}
                      >
                        {isMutating ? "삭제 중…" : "댓글 삭제 확인"}
                      </button>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        삭제 취소
                      </button>
                    </div>
                  </div>
                ) : null}
                {commentMutationError?.commentId === comment.id ? (
                  <p className={styles.commentMutationError}>{commentMutationError.message}</p>
                ) : null}
                {replyDraft?.parentCommentId === comment.id ? (
                  <form
                    className={styles.replyComposer}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void publishReply();
                    }}
                  >
                    <label htmlFor={`reply-${comment.id}`}>답글 작성</label>
                    <textarea
                      id={`reply-${comment.id}`}
                      value={replyDraft.body}
                      maxLength={500}
                      rows={3}
                      placeholder={`${comment.author.displayName}님에게 답글을 남겨 보세요.`}
                      onChange={(event) =>
                        setReplyDraft({ parentCommentId: comment.id, body: event.target.value })
                      }
                    />
                    <div>
                      <span>{Array.from(replyDraft.body).length}/500</span>
                      <button type="submit" disabled={postingReplyId === comment.id}>
                        {postingReplyId === comment.id ? "작성 중…" : "작성"}
                      </button>
                      <button
                        type="button"
                        disabled={postingReplyId === comment.id}
                        onClick={() => setReplyDraft(null)}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                ) : null}
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
                {replies.length > 0 ? (
                  <div className={styles.commentReplies} aria-label="답글 목록">
                    {replies.map(renderReply)}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
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

function NextIssueAutoAdvance({
  currentIssueId,
  currentIssueVersion,
}: {
  currentIssueId: string;
  currentIssueVersion: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const triggeredRef = useRef(false);

  const moveNext = useCallback(async () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    setState("loading");

    try {
      const feed = await loadIssueFeed({ limit: 1, excludeIssueId: currentIssueId });
      const nextIssue = feed.items[0];
      if (!nextIssue) {
        setState("empty");
        void recordAnalyticsEvent({
          eventType: "NEXT_ISSUE_EXHAUSTED",
          issueId: currentIssueId,
          issueVersion: currentIssueVersion,
        }).catch(() => undefined);
        return;
      }
      void recordAnalyticsEvent({
        eventType: "NEXT_ISSUE_OPEN",
        issueId: currentIssueId,
        issueVersion: currentIssueVersion,
      }).catch(() => undefined);
      if (feed.ranking.mode === "PERSONALIZED") {
        void recordAnalyticsEvent({
          eventType: "PERSONALIZED_ISSUE_OPEN",
          issueId: nextIssue.id,
          issueVersion: nextIssue.version,
          recommendationRequestId: nextIssue.recommendation.requestId,
        }).catch(() => undefined);
      }
      router.push(`/issues/${nextIssue.id}`);
    } catch {
      setState("error");
    }
  }, [currentIssueId, currentIssueVersion, router]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          void moveNext();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [moveNext]);

  return (
    <div ref={sentinelRef} className={styles.nextIssue} aria-live="polite">
      <p className={styles.nextIssuePrompt}>
        {state === "idle" ? "조금 더 내려 다음 투표로 이어가세요." : null}
        {state === "loading" ? "다음 질문을 찾는 중…" : null}
      </p>
      {state === "empty" ? <p role="status">지금 참여할 수 있는 질문을 모두 골랐어요.</p> : null}
      {state === "error" ? (
        <p role="alert">다음 질문을 찾지 못했어요. 새로고침 후 다시 시도해 주세요.</p>
      ) : null}
    </div>
  );
}

function ExperienceShell({ children }: { children: ReactNode }) {
  return (
    <WhichShell
      active="home"
      aside={
        <WhichAsideCard
          eyebrow="OPEN QUESTION"
          title="내 선택 뒤에 결과와 댓글이 열립니다."
          tone="orange"
        >
          투표 전에는 어느 쪽이 앞서는지 보여주지 않아요.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        <div className={styles.stage}>{children}</div>
      </div>
    </WhichShell>
  );
}
