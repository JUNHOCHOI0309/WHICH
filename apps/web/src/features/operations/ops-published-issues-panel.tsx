"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import type {
  OpsPublishedIssue,
  OpsPublishedIssueAction,
  OpsPublishedIssuePage,
  OpsPublishedIssueState,
} from "./contracts";
import styles from "./ops-management.module.css";

const stateLabels: Record<OpsPublishedIssueState, string> = {
  ACTIVE: "공개 중",
  HIDDEN: "노출 중지",
  CLOSED: "종료",
  REMOVED: "게시 중단",
};

function dateTime(value: string | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function actionsFor(issue: OpsPublishedIssue): OpsPublishedIssueAction[] {
  if (issue.state === "ACTIVE") return ["HIDE", "REMOVE"];
  if (issue.state === "HIDDEN") return ["RESTORE", "REMOVE"];
  if (issue.state === "CLOSED") return ["REMOVE"];
  return [];
}

const actionLabels: Record<OpsPublishedIssueAction, string> = {
  HIDE: "노출 중지",
  RESTORE: "공개 복구",
  REMOVE: "게시 중단",
};

export function OpsPublishedIssuesPanel() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState<OpsPublishedIssueState | "">("");
  const [page, setPage] = useState<OpsPublishedIssuePage | null>(null);
  const [selected, setSelected] = useState<OpsPublishedIssue | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (submittedQuery) params.set("q", submittedQuery);
      const response = await fetch(`/api/ops/published-issues?${params}`, { cache: "no-store" });
      const body = (await response.json()) as OpsPublishedIssuePage & { message?: string };
      if (!response.ok) throw new Error(body.message || "게시 질문을 불러오지 못했습니다.");
      setPage(body);
      setSelected(
        (current) =>
          body.items.find((item) => item.issueId === current?.issueId) ?? body.items[0] ?? null,
      );
    } catch (caught) {
      setFeedback({
        error: true,
        message: caught instanceof Error ? caught.message : "게시 질문을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, [state, submittedQuery]);

  useEffect(() => {
    // State updates happen after the bounded operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === submittedQuery) void load();
    else setSubmittedQuery(nextQuery);
  }

  async function update(action: OpsPublishedIssueAction) {
    if (!selected) return;
    const rationale = reason.trim();
    if (rationale.length < 10) {
      setFeedback({ error: true, message: "운영 조치 사유를 10자 이상 입력해 주세요." });
      return;
    }
    if (
      action === "REMOVE" &&
      !window.confirm("게시 중단 후에는 이 화면에서 복구할 수 없습니다. 계속할까요?")
    )
      return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/ops/published-issues/${encodeURIComponent(selected.issueId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            expectedUpdatedAt: selected.updatedAt,
            reason: rationale,
          }),
        },
      );
      const body = (await response.json()) as OpsPublishedIssue & { message?: string };
      if (!response.ok) throw new Error(body.message || "게시 질문 상태를 변경하지 못했습니다.");
      await load();
      setReason("");
      setFeedback({ error: false, message: `${actionLabels[action]} 조치를 기록했습니다.` });
    } catch (caught) {
      setFeedback({
        error: true,
        message: caught instanceof Error ? caught.message : "게시 질문 상태를 변경하지 못했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="published-issues-title">
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>LIVE ISSUE CONTROL</p>
          <h1 id="published-issues-title">게시된 질문 관리</h1>
        </div>
        <span>노출 중지·복구·게시 중단은 모두 운영 감사 기록에 남습니다.</span>
      </div>
      <form className={styles.filters} onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="질문, 작성자 또는 Issue UUID"
          maxLength={120}
        />
        <select
          value={state}
          onChange={(event) => setState(event.target.value as OpsPublishedIssueState | "")}
        >
          <option value="">모든 게시 상태</option>
          {Object.entries(stateLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit">조회</button>
      </form>
      {feedback ? (
        <p className={styles.feedback} data-error={feedback.error ? "true" : undefined}>
          {feedback.message}
        </p>
      ) : null}
      <div className={styles.editorialGrid}>
        <div className={styles.candidateList} aria-label="게시 질문 목록">
          {loading ? <p className={styles.empty}>게시 질문을 불러오고 있습니다.</p> : null}
          {page?.items.map((issue) => (
            <button
              type="button"
              className={styles.candidate}
              aria-pressed={selected?.issueId === issue.issueId}
              key={issue.issueId}
              onClick={() => {
                setSelected(issue);
                setReason("");
                setFeedback(null);
              }}
            >
              <span className={styles.candidateMeta}>
                <b>{stateLabels[issue.state]}</b>
                <span>{issue.acceptedVotes.toLocaleString("ko-KR")}표</span>
              </span>
              <strong>{issue.question}</strong>
              <small>
                {issue.categoryCode} · 신고 {issue.reportCount}
              </small>
            </button>
          ))}
          {!loading && !page?.items.length ? (
            <p className={styles.empty}>조건에 맞는 게시 질문이 없습니다.</p>
          ) : null}
        </div>
        {selected ? (
          <article className={styles.detail}>
            <p className={styles.eyebrow}>
              {stateLabels[selected.state]} · {selected.categoryCode} · v{selected.version}
            </p>
            <h2>{selected.question}</h2>
            {selected.context ? <p className={styles.context}>{selected.context}</p> : null}
            <div className={styles.choices}>
              {selected.choices.map((choice) => (
                <div key={choice.code}>
                  <b>{choice.code}</b>
                  <span>{choice.label}</span>
                </div>
              ))}
            </div>
            <div className={styles.facts}>
              <span>{selected.lifecycle}</span>
              <span>{selected.visibility}</span>
              <span>{selected.participation}</span>
              <span>{selected.feedEligibility}</span>
              <span>투표 {selected.acceptedVotes.toLocaleString("ko-KR")}</span>
              <span>신고 {selected.reportCount}</span>
            </div>
            <p className={styles.context}>
              작성자 {selected.author?.displayName ?? "편집 콘텐츠"} · 게시{" "}
              {dateTime(selected.publishedAt)}
              <br />
              <code>{selected.issueId}</code>
            </p>
            <Link href={`/issues/${selected.issueId}`} target="_blank" rel="noreferrer">
              공개 화면 확인 ↗
            </Link>
            {actionsFor(selected).length ? (
              <section className={styles.decision}>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="운영 조치 사유 (10자 이상)"
                  maxLength={1000}
                />
                <div className={styles.decisionActions}>
                  {actionsFor(selected).map((action) => (
                    <button
                      type="button"
                      key={action}
                      disabled={busy}
                      onClick={() => void update(action)}
                    >
                      {actionLabels[action]}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <p className={styles.terminalNotice}>
                게시 중단된 질문에는 추가 조치를 할 수 없습니다.
              </p>
            )}
          </article>
        ) : null}
      </div>
    </section>
  );
}
