"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type {
  OpsEditorialCandidate,
  OpsEditorialDecision,
  OpsEditorialPage,
  OpsEditorialScope,
  OpsEditorialStatus,
  OpsMediaReviewAsset,
  OpsMediaReviewPage,
} from "./contracts";
import styles from "./ops-management.module.css";

const emptyChecks: OpsEditorialDecision["checks"] = {
  binaryFit: false,
  choiceParity: false,
  duplicateReview: false,
  sourceReview: false,
};

const checkLabels: Array<[keyof OpsEditorialDecision["checks"], string]> = [
  ["binaryFit", "질문이 명확한 A/B 선택으로 성립합니다."],
  ["choiceParity", "두 선택지의 표현 강도와 길이가 균형을 이룹니다."],
  ["duplicateReview", "기존 질문과 의미상 중복되지 않습니다."],
  ["sourceReview", "요구되는 출처와 사실 확인 수준을 충족합니다."],
];

function selectedForm(candidate: OpsEditorialCandidate) {
  return {
    note: candidate.decision?.note ?? "",
    checks: candidate.decision?.checks ?? emptyChecks,
  };
}

export function OpsEditorialPanel({
  embedded = false,
  onOpenMediaReview,
}: {
  embedded?: boolean;
  onOpenMediaReview?: () => void;
} = {}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<OpsEditorialStatus | "">("");
  const [scope, setScope] = useState<OpsEditorialScope | "">("");
  const [page, setPage] = useState<OpsEditorialPage | null>(null);
  const [selected, setSelected] = useState<OpsEditorialCandidate | null>(null);
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState(emptyChecks);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaChoiceCode, setMediaChoiceCode] = useState<string | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<OpsMediaReviewAsset[]>([]);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  const choose = useCallback((candidate: OpsEditorialCandidate) => {
    const form = selectedForm(candidate);
    setSelected(candidate);
    setNote(form.note);
    setChecks(form.checks);
    setFeedback(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status) params.set("status", status);
      if (scope) params.set("scope", scope);
      if (submittedQuery) params.set("q", submittedQuery);
      const response = await fetch(`/api/ops/editorial?${params}`, { cache: "no-store" });
      const body = (await response.json()) as OpsEditorialPage & { message?: string };
      if (!response.ok) throw new Error(body.message || "Issue 후보를 불러오지 못했습니다.");
      setPage(body);
      const nextSelected = body.items[0] ?? null;
      if (nextSelected) choose(nextSelected);
      else setSelected(null);
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "Issue 후보를 불러오지 못했습니다.",
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }, [choose, scope, status, submittedQuery]);

  useEffect(() => {
    // The state changes happen after the bounded operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  function updateCandidate(next: OpsEditorialCandidate) {
    setSelected(next);
    setPage((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.candidateId === next.candidateId ? next : item,
            ),
          }
        : current,
    );
  }

  async function openMediaLibrary(choiceCode: string) {
    setMediaChoiceCode(choiceCode);
    setMediaBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ops/media-review/assets?status=APPROVED", {
        cache: "no-store",
      });
      const body = (await response.json()) as OpsMediaReviewPage & { message?: string };
      if (!response.ok) {
        throw new Error(body.message || "승인 이미지 라이브러리를 불러오지 못했습니다.");
      }
      setLibraryAssets(body.items);
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "이미지 라이브러리를 불러오지 못했습니다.",
        error: true,
      });
      setMediaChoiceCode(null);
    } finally {
      setMediaBusy(false);
    }
  }

  async function chooseMedia(asset: OpsMediaReviewAsset) {
    if (!selected || !mediaChoiceCode) return;
    const choice = selected.choices.find((item) => item.code === mediaChoiceCode);
    if (!choice) return;
    const removing = choice.media?.assetId === asset.id;
    setMediaBusy(true);
    setFeedback(null);
    try {
      const path = `/api/ops/editorial/${encodeURIComponent(selected.candidateId)}/choices/${mediaChoiceCode}/media`;
      const response = await fetch(path, {
        method: removing ? "DELETE" : "PUT",
        headers: removing ? undefined : { "content-type": "application/json" },
        body: removing
          ? undefined
          : JSON.stringify({
              assetId: asset.id,
              altText: `${selected.question} - ${choice.label}`.slice(0, 300),
              cropMode: "COVER",
            }),
      });
      const body = (await response.json()) as {
        media?: NonNullable<OpsEditorialCandidate["choices"][number]["media"]>;
        message?: string;
      };
      if (!response.ok) throw new Error(body.message || "선택지 이미지를 저장하지 못했습니다.");
      updateCandidate({
        ...selected,
        choices: selected.choices.map((item) =>
          item.code === mediaChoiceCode
            ? { ...item, media: removing ? null : (body.media ?? null) }
            : item,
        ),
      });
      toast.success(
        removing
          ? `${mediaChoiceCode} 이미지 연결을 해제했어요.`
          : `${mediaChoiceCode} 이미지를 연결했어요.`,
      );
      setMediaChoiceCode(null);
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "선택지 이미지를 저장하지 못했습니다.",
        error: true,
      });
    } finally {
      setMediaBusy(false);
    }
  }

  async function decide(nextStatus: Exclude<OpsEditorialStatus, "PENDING">) {
    if (!selected) return;
    if (nextStatus === "APPROVED" && Object.values(checks).some((checked) => !checked)) {
      setFeedback({
        message: "승인하려면 네 가지 편집 검수 항목을 모두 확인해 주세요.",
        error: true,
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/ops/editorial/${encodeURIComponent(selected.candidateId)}/decision`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: selected.decision?.revision ?? 0,
            status: nextStatus,
            note: note.trim(),
            checks,
          }),
        },
      );
      const body = (await response.json()) as OpsEditorialDecision & {
        code?: string;
        message?: string;
      };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(body.message || "심사 결정을 저장하지 못했습니다.");
      }
      const updated = { ...selected, decision: body };
      setSelected(updated);
      setPage((current) => {
        if (!current) return current;
        const previousStatus = selected.decision?.status ?? "PENDING";
        const counts =
          previousStatus === body.status
            ? current.counts
            : {
                ...current.counts,
                [previousStatus]: Math.max(0, current.counts[previousStatus] - 1),
                [body.status]: current.counts[body.status] + 1,
              };
        return {
          ...current,
          items: current.items.map((item) =>
            item.candidateId === updated.candidateId ? updated : item,
          ),
          counts,
        };
      });
      toast.success(`${body.status} 결정을 revision ${body.revision}로 저장했어요.`);
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "심사 결정을 저장하지 못했습니다.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={embedded ? styles.embeddedReviewPanel : styles.page}>
      {!embedded ? (
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>EDITORIAL REVIEW</p>
            <h1>Issue 인가·반려·수정 요청</h1>
          </div>
          <span>후보 원문은 보존하고 심사 결정과 검수 기록만 운영 DB에 저장합니다.</span>
        </div>
      ) : (
        <div className={styles.embeddedReviewHeading}>
          <div>
            <p className={styles.eyebrow}>ISSUE REVIEW</p>
            <h2>질문 편집 검수</h2>
          </div>
          <button type="button" onClick={onOpenMediaReview}>
            이미지 업로드·검수로 이동
          </button>
        </div>
      )}
      <form className={`${styles.filters} ${styles.editorialFilters}`} onSubmit={submitSearch}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={120}
          placeholder="후보 ID, 질문 또는 설명 검색"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as OpsEditorialStatus | "")}
        >
          <option value="">모든 심사 상태</option>
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="NEEDS_CHANGES">NEEDS_CHANGES</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as OpsEditorialScope | "")}
        >
          <option value="">모든 재고 범위</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="RESERVE">RESERVE</option>
          <option value="LONG_TERM">LONG_TERM</option>
        </select>
        <button type="submit">검색</button>
      </form>
      {page ? (
        <div className={styles.counts}>
          {(["PENDING", "APPROVED", "NEEDS_CHANGES", "REJECTED"] as const).map((value) => (
            <article key={value}>
              <span>{value}</span>
              <strong>{page.counts[value]}</strong>
            </article>
          ))}
        </div>
      ) : null}
      {feedback ? (
        <p className={styles.feedback} data-error={feedback.error}>
          {feedback.message}
        </p>
      ) : null}
      <div className={styles.editorialGrid}>
        <div className={styles.candidateList} aria-busy={loading}>
          {page?.items.map((candidate) => (
            <button
              type="button"
              className={styles.candidate}
              key={candidate.candidateId}
              aria-pressed={selected?.candidateId === candidate.candidateId}
              onClick={() => choose(candidate)}
            >
              <span className={styles.candidateMeta}>
                <span>
                  {candidate.candidateId} · {candidate.inventoryScope}
                </span>
                <span>{candidate.decision?.status ?? "PENDING"}</span>
              </span>
              <strong>{candidate.question}</strong>
            </button>
          ))}
          {!loading && page?.items.length === 0 ? (
            <div className={styles.empty}>조건에 맞는 후보가 없습니다.</div>
          ) : null}
        </div>
        {selected ? (
          <article className={styles.detail}>
            <p className={styles.eyebrow}>
              {selected.candidateId} · {selected.automatedReviewStatus}
            </p>
            <h2>{selected.question}</h2>
            <p className={styles.context}>{selected.context}</p>
            <div className={styles.choices}>
              {selected.choices.map((choice) => (
                <div key={choice.code}>
                  <b>{choice.code}</b>
                  <span>{choice.label}</span>
                </div>
              ))}
            </div>
            <section
              className={styles.candidateMediaSection}
              aria-labelledby="candidate-media-title"
            >
              <div className={styles.candidateMediaHeading}>
                <div>
                  <h3 id="candidate-media-title">선택지 이미지</h3>
                  <p>승인 라이브러리에서 지정하거나 Image Review에서 새 이미지를 등록하세요.</p>
                </div>
                <button type="button" onClick={onOpenMediaReview}>
                  새 이미지 업로드
                </button>
              </div>
              <div className={styles.candidateMediaGrid}>
                {selected.choices.map((choice) => (
                  <article key={choice.code} data-linked={!!choice.media}>
                    <div className={styles.candidateMediaPreview}>
                      {choice.media ? (
                        <Image
                          src={`/api/ops/media-review/assets/${choice.media.assetId}/content`}
                          alt={choice.media.altText}
                          width={400}
                          height={300}
                          unoptimized
                        />
                      ) : (
                        <span>이미지 없음</span>
                      )}
                      <b>{choice.code}</b>
                    </div>
                    <strong>{choice.label}</strong>
                    <small>{choice.media ? choice.media.status : "TEXT ONLY"}</small>
                    <button
                      type="button"
                      disabled={mediaBusy}
                      onClick={() => void openMediaLibrary(choice.code)}
                    >
                      {choice.media ? "이미지 변경·해제" : "라이브러리에서 선택"}
                    </button>
                  </article>
                ))}
              </div>
              {mediaChoiceCode ? (
                <div className={styles.mediaLibrary} role="dialog" aria-modal="true">
                  <div className={styles.mediaLibraryHeader}>
                    <div>
                      <p className={styles.eyebrow}>APPROVED LIBRARY</p>
                      <h3>{mediaChoiceCode} 이미지 선택</h3>
                    </div>
                    <button type="button" onClick={() => setMediaChoiceCode(null)}>
                      닫기
                    </button>
                  </div>
                  {libraryAssets.length ? (
                    <div className={styles.mediaLibraryGrid}>
                      {libraryAssets.map((asset) => {
                        const current = selected.choices.find(
                          (choice) => choice.code === mediaChoiceCode,
                        )?.media?.assetId;
                        const usedElsewhere = selected.choices.some(
                          (choice) =>
                            choice.code !== mediaChoiceCode && choice.media?.assetId === asset.id,
                        );
                        return (
                          <button
                            type="button"
                            key={asset.id}
                            data-selected={current === asset.id}
                            disabled={mediaBusy || usedElsewhere}
                            onClick={() => void chooseMedia(asset)}
                          >
                            <Image
                              src={`/api/ops/media-review/assets/${asset.id}/content`}
                              alt={asset.link?.altText ?? "승인 이미지"}
                              width={240}
                              height={240}
                              unoptimized
                            />
                            <span>{current === asset.id ? "한 번 더 눌러 해제" : "선택"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.empty}>사용할 수 있는 승인 이미지가 없습니다.</p>
                  )}
                </div>
              ) : null}
            </section>
            <div className={styles.facts}>
              <span>{selected.category}</span>
              <span>{selected.editorialArea}</span>
              <span>{selected.riskLevel}</span>
              <span>{selected.inventoryScope}</span>
            </div>
            {selected.sources.length ? (
              <ul className={styles.sources}>
                {selected.sources.map((source) => (
                  <li key={source.id}>
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title || source.id} ↗
                      </a>
                    ) : (
                      source.title || source.id
                    )}{" "}
                    · {source.kind}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.decision}>
              <div className={styles.checks}>
                {checkLabels.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={checks[key]}
                      onChange={(event) =>
                        setChecks((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <textarea
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="수정 요청 또는 심사 근거를 남겨 주세요."
              />
              <div className={styles.decisionActions}>
                <button type="button" disabled={saving} onClick={() => void decide("APPROVED")}>
                  인가
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void decide("NEEDS_CHANGES")}
                >
                  수정 요청
                </button>
                <button type="button" disabled={saving} onClick={() => void decide("REJECTED")}>
                  반려
                </button>
              </div>
              {selected.decision ? (
                <small>
                  revision {selected.decision.revision} · {selected.decision.reviewedBy} ·{" "}
                  {new Date(selected.decision.reviewedAt).toLocaleString("ko-KR")}
                </small>
              ) : (
                <small>아직 저장된 운영 결정이 없습니다.</small>
              )}
            </div>
          </article>
        ) : (
          <div className={styles.empty}>검토할 후보를 선택해 주세요.</div>
        )}
      </div>
    </section>
  );
}
