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
  OpsPublishedIssue,
} from "./contracts";
import { OpsAdminMediaLibrary } from "./ops-admin-media-library";
import styles from "./ops-management.module.css";

const pageSize = 50;
const editorialStatusLabels: Record<OpsEditorialStatus, string> = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  NEEDS_CHANGES: "수정 필요",
  REJECTED: "REJECTED",
  PUBLISHED: "게시 완료",
};
const interestCards = [
  ["DAILY_LIFE", "일상"],
  ["FOOD", "음식"],
  ["TRAVEL", "여행"],
  ["RELATIONSHIP", "관계"],
  ["WORK", "직장·커리어"],
  ["ECONOMY_CONSUMPTION", "경제·소비"],
  ["TECH", "테크"],
  ["GAME", "게임"],
  ["MOVIE_DRAMA", "영화·드라마"],
  ["MUSIC_CONTENT", "음악·콘텐츠"],
  ["SPORTS", "스포츠"],
  ["EDUCATION", "교육"],
  ["SOCIETY", "사회"],
  ["HOBBY", "취미"],
] as const;

async function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function OpsEditorialPanel({
  embedded = false,
  onPublished,
}: {
  embedded?: boolean;
  onPublished?: () => void;
} = {}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<OpsEditorialStatus | "">("");
  const [scope, setScope] = useState<OpsEditorialScope | "">("");
  const [page, setPage] = useState<OpsEditorialPage | null>(null);
  const [selected, setSelected] = useState<OpsEditorialCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    question: "",
    context: "",
    choiceA: "",
    choiceB: "",
    interestCardCode: "DAILY_LIFE",
  });

  const choose = useCallback((candidate: OpsEditorialCandidate) => {
    setSelected(candidate);
    setFeedback(null);
  }, []);

  const requestPage = useCallback(
    async (cursor?: string | null) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (status) params.set("status", status);
      if (scope) params.set("scope", scope);
      if (submittedQuery) params.set("q", submittedQuery);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/ops/editorial?${params}`, { cache: "no-store" });
      const body = (await response.json()) as OpsEditorialPage & { message?: string };
      if (!response.ok) throw new Error(body.message || "질문 후보를 불러오지 못했습니다.");
      return body;
    },
    [scope, status, submittedQuery],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const body = await requestPage();
      setPage(body);
      setSelected(
        (current) =>
          body.items.find((candidate) => candidate.candidateId === current?.candidateId) ??
          body.items[0] ??
          null,
      );
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "질문 후보를 불러오지 못했습니다.",
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }, [requestPage]);

  useEffect(() => {
    // State is updated only after the bounded operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const body = await requestPage(page.nextCursor);
      setPage((current) => {
        if (!current) return body;
        const loaded = new Set(current.items.map((item) => item.candidateId));
        return {
          ...body,
          items: [...current.items, ...body.items.filter((item) => !loaded.has(item.candidateId))],
        };
      });
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "다음 질문 후보를 불러오지 못했습니다.",
        error: true,
      });
    } finally {
      setLoadingMore(false);
    }
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

  async function createCandidate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ops/editorial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: createForm.question.trim(),
          context: createForm.context.trim(),
          choices: [createForm.choiceA.trim(), createForm.choiceB.trim()],
          interestCardCode: createForm.interestCardCode,
        }),
      });
      const body = (await response.json()) as {
        candidate?: OpsEditorialCandidate;
        message?: string;
      };
      if (!response.ok || !body.candidate) {
        throw new Error(body.message || "질문 후보를 추가하지 못했습니다.");
      }
      const candidate = body.candidate;
      setPage((current) =>
        current
          ? {
              ...current,
              catalog: { ...current.catalog, total: current.catalog.total + 1 },
              inventory: { ...current.inventory, active: current.inventory.active + 1 },
              counts: { ...current.counts, PENDING: current.counts.PENDING + 1 },
              items: [candidate, ...current.items],
            }
          : current,
      );
      choose(candidate);
      setCreateForm({
        question: "",
        context: "",
        choiceA: "",
        choiceB: "",
        interestCardCode: "DAILY_LIFE",
      });
      setCreateOpen(false);
      toast.success("관리자 질문을 검수 후보에 추가했습니다.");
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "질문 후보를 추가하지 못했습니다.",
        error: true,
      });
    } finally {
      setCreating(false);
    }
  }

  async function uploadChoiceMedia(choiceCode: string, file: File) {
    if (!selected) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFeedback({ message: "JPG, PNG, WebP 이미지만 사용할 수 있습니다.", error: true });
      return;
    }
    const choice = selected.choices.find((item) => item.code === choiceCode);
    if (!choice) return;
    setMediaBusy(choiceCode);
    setFeedback(null);
    try {
      const uploadResponse = await fetch("/api/ops/editorial/media-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "OPERATOR_UPLOAD",
          rightsAttestation: "WHICH 관리자가 서비스 게시 권리를 확인한 직접 업로드 이미지",
          declaredMimeType: file.type,
          contentBase64: await fileBase64(file),
        }),
      });
      const uploadBody = (await uploadResponse.json()) as {
        asset?: { id: string; moderationState: string; storageState: string };
        message?: string;
      };
      if (!uploadResponse.ok || !uploadBody.asset?.id) {
        throw new Error(uploadBody.message || `${choiceCode} 이미지를 등록하지 못했습니다.`);
      }
      const assetId = uploadBody.asset.id;
      if (
        uploadBody.asset.moderationState !== "APPROVED" ||
        uploadBody.asset.storageState !== "PUBLISHED"
      ) {
        const publishResponse = await fetch(
          `/api/ops/editorial/media-assets/${encodeURIComponent(assetId)}/publish`,
          { method: "POST" },
        );
        const publishBody = (await publishResponse.json()) as { message?: string };
        if (!publishResponse.ok) {
          throw new Error(publishBody.message || `${choiceCode} 이미지를 게시하지 못했습니다.`);
        }
      }
      const attachResponse = await fetch(
        `/api/ops/editorial/${encodeURIComponent(selected.candidateId)}/choices/${choiceCode}/media`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assetId,
            altText: `${selected.question} - ${choice.label}`.slice(0, 300),
            cropMode: "COVER",
          }),
        },
      );
      const attachBody = (await attachResponse.json()) as {
        media?: NonNullable<OpsEditorialCandidate["choices"][number]["media"]>;
        message?: string;
      };
      if (!attachResponse.ok || !attachBody.media) {
        throw new Error(attachBody.message || "선택지 이미지를 연결하지 못했습니다.");
      }
      updateCandidate({
        ...selected,
        choices: selected.choices.map((item) =>
          item.code === choiceCode ? { ...item, media: attachBody.media! } : item,
        ),
      });
      toast.success(`${choiceCode} 이미지를 즉시 승인해 연결했습니다.`);
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "이미지를 등록하지 못했습니다.",
        error: true,
      });
    } finally {
      setMediaBusy(null);
    }
  }

  async function detachChoiceMedia(choiceCode: string) {
    if (!selected) return;
    setMediaBusy(choiceCode);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/ops/editorial/${encodeURIComponent(selected.candidateId)}/choices/${choiceCode}/media`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message || "이미지 연결을 해제하지 못했습니다.");
      updateCandidate({
        ...selected,
        choices: selected.choices.map((item) =>
          item.code === choiceCode ? { ...item, media: null } : item,
        ),
      });
      toast.success(`${choiceCode} 이미지 연결을 해제했습니다.`);
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "이미지 연결을 해제하지 못했습니다.",
        error: true,
      });
    } finally {
      setMediaBusy(null);
    }
  }

  async function decide(nextStatus: "APPROVED" | "REJECTED") {
    if (!selected) return;
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
          }),
        },
      );
      const body = (await response.json()) as OpsEditorialDecision & { message?: string };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(body.message || "심사 결정을 저장하지 못했습니다.");
      }
      const previousStatus = selected.decision?.status ?? "PENDING";
      if (status === previousStatus && body.status !== status) {
        const selectedIndex =
          page?.items.findIndex((item) => item.candidateId === selected.candidateId) ?? 0;
        const remainingItems =
          page?.items.filter((item) => item.candidateId !== selected.candidateId) ?? [];
        setSelected(
          remainingItems[Math.min(Math.max(selectedIndex, 0), remainingItems.length - 1)] ?? null,
        );
        setPage((current) => {
          if (!current) return current;
          const items = current.items.filter((item) => item.candidateId !== selected.candidateId);
          return {
            ...current,
            items,
            counts: {
              ...current.counts,
              [previousStatus]: Math.max(0, current.counts[previousStatus] - 1),
              [body.status]: current.counts[body.status] + 1,
            },
          };
        });
      } else {
        const updated = { ...selected, decision: body };
        setSelected(updated);
        setPage((current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.candidateId === updated.candidateId ? updated : item,
                ),
                counts:
                  previousStatus === body.status
                    ? current.counts
                    : {
                        ...current.counts,
                        [previousStatus]: Math.max(0, current.counts[previousStatus] - 1),
                        [body.status]: current.counts[body.status] + 1,
                      },
              }
            : current,
        );
      }
      toast.success(nextStatus === "APPROVED" ? "질문을 인가했습니다." : "질문을 반려했습니다.");
    } catch (caught) {
      setFeedback({
        message: caught instanceof Error ? caught.message : "심사 결정을 저장하지 못했습니다.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  async function publishApprovedCandidates() {
    setPublishing(true);
    setFeedback(null);
    try {
      const approved: OpsEditorialCandidate[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: String(pageSize), status: "APPROVED" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/ops/editorial?${params}`, { cache: "no-store" });
        const body = (await response.json()) as OpsEditorialPage & { message?: string };
        if (!response.ok) {
          throw new Error(body.message || "승인된 질문 목록을 불러오지 못했습니다.");
        }
        approved.push(...body.items.filter((candidate) => !candidate.publication));
        cursor = body.nextCursor;
      } while (cursor);

      const candidates = Array.from(
        new Map(approved.map((candidate) => [candidate.candidateId, candidate])).values(),
      );
      if (candidates.length === 0) {
        toast.success("새로 게시할 APPROVED 질문이 없습니다.");
        return;
      }

      let publishedCount = 0;
      const failures: Array<{ candidateId: string; message: string }> = [];
      const batchSize = 5;
      for (let index = 0; index < candidates.length; index += batchSize) {
        const results = await Promise.all(
          candidates.slice(index, index + batchSize).map(async (candidate) => {
            try {
              const response = await fetch(
                `/api/ops/editorial/${encodeURIComponent(candidate.candidateId)}/publish`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ expectedRevision: candidate.decision!.revision }),
                },
              );
              const body = (await response.json()) as {
                issue?: OpsPublishedIssue;
                message?: string;
              };
              return response.ok && body.issue
                ? { published: true as const, candidateId: candidate.candidateId }
                : {
                    published: false as const,
                    candidateId: candidate.candidateId,
                    message: body.message || "게시하지 못했습니다.",
                  };
            } catch (caught) {
              return {
                published: false as const,
                candidateId: candidate.candidateId,
                message: caught instanceof Error ? caught.message : "게시 요청에 실패했습니다.",
              };
            }
          }),
        );
        for (const result of results) {
          if (result.published) publishedCount += 1;
          else failures.push({ candidateId: result.candidateId, message: result.message });
        }
      }

      await load();
      if (failures.length > 0) {
        const preview = failures
          .slice(0, 3)
          .map((failure) => `${failure.candidateId}: ${failure.message}`)
          .join(" / ");
        setFeedback({
          message: `${publishedCount}개 게시 완료, ${failures.length}개 실패 — ${preview}`,
          error: true,
        });
        toast.error(`${publishedCount}개를 게시했고 ${failures.length}개는 게시하지 못했습니다.`);
        return;
      }

      toast.success(`${publishedCount}개의 APPROVED 질문을 게시했습니다.`);
      onPublished?.();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "APPROVED 질문을 일괄 게시하지 못했습니다.",
        error: true,
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className={embedded ? styles.embeddedReviewPanel : styles.page}>
      <div className={embedded ? styles.embeddedReviewHeading : styles.intro}>
        <div>
          <p className={styles.eyebrow}>ISSUE REVIEW</p>
          <h2>관리자 질문 검수</h2>
          <span>관리자 질문과 이미지는 이곳에서 바로 검수하고 게시합니다.</span>
        </div>
        <div className={styles.editorialHeadingActions}>
          <button
            type="button"
            disabled={publishing || loading}
            data-primary="true"
            onClick={() => void publishApprovedCandidates()}
          >
            {publishing ? "APPROVED 질문 게시 중…" : "APPROVED 질문 일괄 게시"}
          </button>
          <button type="button" onClick={() => setCreateOpen((current) => !current)}>
            {createOpen ? "추가 닫기" : "새 질문 추가"}
          </button>
        </div>
      </div>

      {createOpen ? (
        <form className={styles.editorialCreateForm} onSubmit={createCandidate}>
          <h3>관리자 질문 추가</h3>
          <input
            required
            maxLength={200}
            value={createForm.question}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, question: event.target.value }))
            }
            placeholder="질문"
          />
          <textarea
            required
            maxLength={500}
            value={createForm.context}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, context: event.target.value }))
            }
            placeholder="짧은 설명"
          />
          <div>
            <input
              required
              maxLength={100}
              value={createForm.choiceA}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, choiceA: event.target.value }))
              }
              placeholder="A 선택지"
            />
            <input
              required
              maxLength={100}
              value={createForm.choiceB}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, choiceB: event.target.value }))
              }
              placeholder="B 선택지"
            />
          </div>
          <select
            value={createForm.interestCardCode}
            onChange={(event) =>
              setCreateForm((current) => ({ ...current, interestCardCode: event.target.value }))
            }
          >
            {interestCards.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={creating}>
            {creating ? "추가 중…" : "검수 후보에 추가"}
          </button>
        </form>
      ) : null}

      <form
        className={`${styles.filters} ${styles.editorialFilters}`}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query.trim());
        }}
      >
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
          <option value="PUBLISHED">게시 완료</option>
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
          {(["PENDING", "APPROVED", "PUBLISHED", "REJECTED"] as const).map((value) => (
            <article key={value}>
              <span>{editorialStatusLabels[value]}</span>
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
                <span>
                  {candidate.publication ? "게시 완료" : (candidate.decision?.status ?? "PENDING")}
                </span>
              </span>
              <strong>{candidate.question}</strong>
            </button>
          ))}
          {!loading && page?.items.length === 0 ? (
            <div className={styles.empty}>조건에 맞는 후보가 없습니다.</div>
          ) : null}
          {page?.nextCursor ? (
            <div className={styles.candidateListMore}>
              <span>{page.items.length}개 표시 중</span>
              <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "불러오는 중…" : `다음 ${pageSize}개 불러오기`}
              </button>
            </div>
          ) : null}
        </div>

        {selected ? (
          <article className={styles.detail}>
            {selected.publication ? (
              <div className={styles.publicationComplete}>
                <strong>게시 완료</strong>
                <span>{new Date(selected.publication.publishedAt).toLocaleString("ko-KR")}</span>
              </div>
            ) : null}
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

            <section className={styles.candidateMediaSection}>
              <div className={styles.candidateMediaHeading}>
                <div>
                  <h3>선택지 이미지</h3>
                  <p>관리자 업로드는 별도 이미지 검수 없이 즉시 승인되어 선택지에 연결됩니다.</p>
                </div>
              </div>
              <div className={styles.candidateMediaGrid}>
                {selected.choices.map((choice) => (
                  <article key={choice.code} data-linked={!!choice.media}>
                    <div className={styles.candidateMediaPreview}>
                      {choice.media ? (
                        <Image
                          src={`/api/ops/editorial/media-assets/${choice.media.assetId}/content`}
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
                    <small>{choice.media?.assetId ?? "TEXT ONLY"}</small>
                    <label className={styles.candidateMediaUpload}>
                      <span>
                        {mediaBusy === choice.code
                          ? "처리 중…"
                          : choice.media
                            ? "새 이미지로 교체"
                            : "새 이미지 업로드"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={mediaBusy !== null || !!selected.publication}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadChoiceMedia(choice.code, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {choice.media ? (
                      <button
                        type="button"
                        disabled={mediaBusy !== null || !!selected.publication}
                        onClick={() => void detachChoiceMedia(choice.code)}
                      >
                        이미지 제거
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
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
              <div className={styles.decisionActions}>
                <button
                  type="button"
                  disabled={saving || publishing || !!selected.publication}
                  onClick={() => void decide("APPROVED")}
                >
                  인가
                </button>
                <button
                  type="button"
                  disabled={saving || publishing || !!selected.publication}
                  onClick={() => void decide("REJECTED")}
                >
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

      <OpsAdminMediaLibrary />
    </section>
  );
}
