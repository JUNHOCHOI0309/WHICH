"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  OpsPublishedIssue,
  OpsPublishedIssueAction,
  OpsPublishedIssuePage,
  OpsPublishedIssueState,
} from "./contracts";
import styles from "./ops-management.module.css";

type ChoiceCode = "A" | "B" | "C" | "D";

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
  RESOLVE_REPORTS: "신고 처리 완료",
  DISMISS_REPORTS: "신고 기각",
};

const reportReasonLabels: Record<string, string> = {
  SPAM: "스팸·도배",
  INSULT_OR_HARASSMENT: "모욕·괴롭힘",
  HATE: "혐오 표현",
  THREAT: "위협",
  PRIVACY: "개인정보 침해",
  SEXUAL: "선정성",
  IMPERSONATION: "사칭",
  ILLEGAL_ACTIVITY: "불법 행위",
  OTHER: "기타",
};

function ChoiceMediaPreview({
  file,
  assetId,
  alt,
}: {
  file?: File;
  assetId?: string;
  alt: string;
}) {
  const preview = useMemo(
    () => (file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  const source = preview ?? (assetId ? `/api/ops/media-review/assets/${assetId}/content` : null);
  return source ? <img src={source} alt={alt} /> : <span>등록된 이미지 없음</span>;
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function OpsPublishedIssuesPanel() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState<OpsPublishedIssueState | "">("");
  const [reportedOnly, setReportedOnly] = useState(false);
  const [page, setPage] = useState<OpsPublishedIssuePage | null>(null);
  const [selected, setSelected] = useState<OpsPublishedIssue | null>(null);
  const [rightsAttestation, setRightsAttestation] = useState("");
  const [choiceFiles, setChoiceFiles] = useState<Partial<Record<ChoiceCode, File>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (reportedOnly) params.set("reported", "true");
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
  }, [state, submittedQuery, reportedOnly]);

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
            expectedReportCaseId: action.endsWith("_REPORTS")
              ? selected.activeReportReview?.caseId
              : undefined,
            expectedReportUpdatedAt: action.endsWith("_REPORTS")
              ? selected.activeReportReview?.updatedAt
              : undefined,
          }),
        },
      );
      const body = (await response.json()) as OpsPublishedIssue & { message?: string };
      if (!response.ok) throw new Error(body.message || "게시 질문 상태를 변경하지 못했습니다.");
      await load();
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

  async function reviseMedia() {
    if (!selected) return;
    const files = Object.values(choiceFiles).filter(Boolean) as File[];
    if (files.length > 0 && !rightsAttestation.trim()) {
      setFeedback({ error: true, message: "새 이미지의 권리 근거를 입력해 주세요." });
      return;
    }
    if (selected.choices.some((choice) => !choice.media && !choiceFiles[choice.code])) {
      setFeedback({
        error: true,
        message: "A/B를 포함한 모든 선택지에 이미지를 지정해 주세요.",
      });
      return;
    }
    if (
      selected.acceptedVotes > 0 &&
      !window.confirm(
        "이미지 수정은 새 질문 버전으로 공개되며 최신 버전의 투표 집계는 0표부터 시작합니다. 계속할까요?",
      )
    )
      return;

    setBusy(true);
    setFeedback(null);
    try {
      const choices = [] as Array<{
        code: ChoiceCode;
        assetId: string;
        altText: string;
        cropMode: "COVER" | "CONTAIN";
      }>;
      for (const choice of selected.choices) {
        const file = choiceFiles[choice.code];
        let assetId = choice.media?.assetId;
        if (file) {
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            throw new Error(`${choice.code} 이미지는 JPG, PNG, WebP만 사용할 수 있습니다.`);
          }
          const uploadResponse = await fetch("/api/ops/media-review/assets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sourceType: "OPERATOR_UPLOAD",
              rightsAttestation: rightsAttestation.trim(),
              declaredMimeType: file.type,
              contentBase64: await fileBase64(file),
            }),
          });
          const uploadBody = (await uploadResponse.json()) as {
            asset?: { id: string; moderationState: string; storageState: string };
            message?: string;
          };
          if (!uploadResponse.ok || !uploadBody.asset?.id) {
            throw new Error(uploadBody.message || `${choice.code} 이미지를 등록하지 못했습니다.`);
          }
          assetId = uploadBody.asset.id;
          if (
            uploadBody.asset.moderationState !== "APPROVED" ||
            uploadBody.asset.storageState !== "PUBLISHED"
          ) {
            const approvalResponse = await fetch(
              `/api/ops/media-review/assets/${encodeURIComponent(assetId)}/decision`,
              {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  status: "APPROVED",
                  reasonCode: "OPS_ISSUE_MEDIA_REVISION",
                  rationale: "게시 질문 선택지 이미지 관리자 승인",
                  policyVersion: "issue-media-review-v1",
                }),
              },
            );
            const approvalBody = (await approvalResponse.json()) as { message?: string };
            if (!approvalResponse.ok) {
              throw new Error(
                approvalBody.message || `${choice.code} 이미지를 승인하지 못했습니다.`,
              );
            }
          }
        }
        if (!assetId) throw new Error(`${choice.code} 이미지가 없습니다.`);
        choices.push({
          code: choice.code,
          assetId,
          altText: choice.media?.altText || choice.label,
          cropMode: choice.media?.cropMode || "CONTAIN",
        });
      }
      const response = await fetch(
        `/api/ops/published-issues/${encodeURIComponent(selected.issueId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: selected.version,
            expectedUpdatedAt: selected.updatedAt,
            choices,
          }),
        },
      );
      const body = (await response.json()) as OpsPublishedIssue & { message?: string };
      if (!response.ok) throw new Error(body.message || "질문 이미지를 수정하지 못했습니다.");
      setChoiceFiles({});
      setRightsAttestation("");
      await load();
      setFeedback({
        error: false,
        message: `이미지를 적용한 v${body.version} 수정본을 공개했습니다.`,
      });
    } catch (caught) {
      setFeedback({
        error: true,
        message: caught instanceof Error ? caught.message : "질문 이미지를 수정하지 못했습니다.",
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
      <form className={`${styles.filters} ${styles.publishedFilters}`} onSubmit={submit}>
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
        <label className={styles.reportedOnlyFilter}>
          <input
            type="checkbox"
            checked={reportedOnly}
            onChange={(event) => setReportedOnly(event.target.checked)}
          />
          신고 처리 필요만
        </label>
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
                setRightsAttestation("");
                setChoiceFiles({});
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
                {issue.activeReportReview
                  ? ` · 처리 필요 ${issue.activeReportReview.reportCount}`
                  : ""}
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
            <div className={styles.choiceMediaEditor}>
              {selected.choices.map((choice) => (
                <article key={choice.code}>
                  <div className={styles.choiceMediaPreview}>
                    <ChoiceMediaPreview
                      file={choiceFiles[choice.code]}
                      assetId={choice.media?.assetId}
                      alt={`${choice.code} ${choice.label}`}
                    />
                  </div>
                  <div className={styles.choiceMediaMeta}>
                    <b>{choice.code}</b>
                    <span>{choice.label}</span>
                    <label>
                      {choice.media ? "이미지 교체" : "이미지 추가"}
                      <input
                        key={`${selected.issueId}:${selected.version}:${choice.code}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy || selected.state === "REMOVED"}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          setChoiceFiles((current) => ({ ...current, [choice.code]: file }));
                        }}
                      />
                    </label>
                  </div>
                </article>
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
            {selected.activeReportReview ? (
              <section className={styles.reportReview} aria-label="신고 검토 상세">
                <div className={styles.reportReviewHeader}>
                  <div>
                    <strong>신고 검토 필요</strong>
                    <span>
                      {selected.activeReportReview.status} · {selected.activeReportReview.priority}{" "}
                      · {selected.activeReportReview.reportCount}건
                    </span>
                  </div>
                  <small>최근 갱신 {dateTime(selected.activeReportReview.updatedAt)}</small>
                </div>
                <div className={styles.reportDetails}>
                  {selected.activeReportReview.reports.map((report) => (
                    <article key={report.id}>
                      <div>
                        <b>{reportReasonLabels[report.reasonCode] ?? report.reasonCode}</b>
                        <span>
                          {report.reporterKind} · 가중치 {report.weight} ·{" "}
                          {dateTime(report.createdAt)}
                        </span>
                      </div>
                      <p>{report.detail || "추가 설명 없음"}</p>
                    </article>
                  ))}
                </div>
                <p className={styles.context}>
                  노출 중지 또는 게시 중단을 선택하면 열린 신고 건도 자동으로 처리 완료됩니다.
                </p>
              </section>
            ) : null}
            {selected.state !== "REMOVED" ? (
              <section className={styles.mediaRevision}>
                <div>
                  <strong>선택지 이미지 수정</strong>
                  <span>
                    모든 선택지 이미지를 갖춘 새 버전을 공개합니다. 기존 버전과 투표 기록은
                    보존됩니다.
                  </span>
                </div>
                <input
                  value={rightsAttestation}
                  onChange={(event) => setRightsAttestation(event.target.value)}
                  placeholder="새 이미지 권리 근거 (직접 촬영·라이선스 등)"
                  disabled={busy}
                />
                <button type="button" disabled={busy} onClick={() => void reviseMedia()}>
                  이미지 수정본 공개
                </button>
              </section>
            ) : null}
            {actionsFor(selected).length || selected.activeReportReview ? (
              <section className={styles.decision}>
                <div className={styles.decisionActions}>
                  {selected.activeReportReview ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void update("DISMISS_REPORTS")}
                      >
                        신고 기각
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void update("RESOLVE_REPORTS")}
                      >
                        신고 처리 완료
                      </button>
                    </>
                  ) : null}
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
