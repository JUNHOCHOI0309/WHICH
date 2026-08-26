"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";

import type { OpsMediaReviewAsset, OpsMediaReviewPage, OpsMediaRightsRequest } from "./contracts";
import styles from "./ops-management.module.css";

const policyVersion = "issue-media-review-v1";
type AssetAction = "APPROVED" | "REJECTED" | "HIDDEN" | "RESTORED" | "DELETED";

const actionLabels: Record<AssetAction, string> = {
  APPROVED: "승인",
  REJECTED: "반려",
  HIDDEN: "블라인드",
  RESTORED: "복구",
  DELETED: "삭제",
};

export function reviewActionsForStatus(
  status: OpsMediaReviewAsset["effectiveStatus"],
): AssetAction[] {
  if (status === "PENDING") return ["APPROVED", "REJECTED", "DELETED"];
  if (status === "APPROVED") return ["HIDDEN", "DELETED"];
  if (status === "HIDDEN") return ["RESTORED", "DELETED"];
  if (status === "REJECTED") return ["DELETED"];
  return [];
}

function issueActionsForStatus(status: OpsMediaReviewAsset["effectiveStatus"]): AssetAction[] {
  if (status === "APPROVED") return ["HIDDEN", "DELETED"];
  if (status === "HIDDEN") return ["RESTORED", "DELETED"];
  return [];
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "운영 요청에 실패했습니다.");
  return body;
}

export function OpsMediaReviewPanel() {
  const [page, setPage] = useState<OpsMediaReviewPage | null>(null);
  const [rights, setRights] = useState<OpsMediaRightsRequest[]>([]);
  const [selected, setSelected] = useState<OpsMediaReviewAsset | null>(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [rationale, setRationale] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [rightsAttestation, setRightsAttestation] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    const [assets, requests] = await Promise.all([
      json<OpsMediaReviewPage>(
        await fetch(`/api/ops/media-review/assets?${params}`, { cache: "no-store" }),
      ),
      json<{ items: OpsMediaRightsRequest[] }>(
        await fetch("/api/ops/media-review/rights-requests", { cache: "no-store" }),
      ),
    ]);
    setPage(assets);
    setRights(requests.items);
    setSelected(
      (current) => assets.items.find((item) => item.id === current?.id) ?? assets.items[0] ?? null,
    );
  }, [query, status]);

  useEffect(() => {
    // The state updates happen only after both remote operations requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((error) =>
      toast.error(error instanceof Error ? error.message : "검수 큐를 불러오지 못했습니다."),
    );
  }, [load]);

  async function decide(targetStatus: AssetAction, scope: "ASSET" | "ISSUE" = "ASSET") {
    if (!selected || rationale.trim().length < 10)
      return toast.error("판단 근거를 10자 이상 입력해 주세요.");
    setBusy(true);
    try {
      const target =
        scope === "ISSUE"
          ? `/api/ops/media-review/issues/${selected.link?.issueId}/decision`
          : `/api/ops/media-review/assets/${selected.id}/decision`;
      await json(
        await fetch(target, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: targetStatus,
            reasonCode: scope === "ISSUE" ? "ISSUE_MEDIA_REVIEW" : "ASSET_MEDIA_REVIEW",
            rationale: rationale.trim(),
            policyVersion,
          }),
        }),
      );
      toast.success(`${scope === "ISSUE" ? "Issue" : "이미지"} 검수 결정을 기록했습니다.`);
      setRationale("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "검수 결정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!uploadFile || rightsAttestation.trim().length < 20) {
      return toast.error("이미지와 20자 이상의 권리 근거를 입력해 주세요.");
    }
    setBusy(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(uploadFile);
      });
      await json(
        await fetch("/api/ops/media-review/assets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType: "OPERATOR_UPLOAD",
            rightsAttestation: rightsAttestation.trim(),
            declaredMimeType: uploadFile.type,
            contentBase64,
          }),
        }),
      );
      setUploadFile(null);
      setRightsAttestation("");
      toast.success("이미지를 비공개 검수 큐에 등록했습니다.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "이미지 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function reportRights(type: "PRIVACY" | "DEFAMATION" | "COPYRIGHT") {
    if (!selected || rationale.trim().length < 10)
      return toast.error("요청 내용을 10자 이상 입력해 주세요.");
    setBusy(true);
    try {
      await json(
        await fetch("/api/ops/media-review/rights-requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestType: type,
            assetId: selected.id,
            requesterReference: "operator-console",
            details: rationale.trim(),
            policyVersion,
          }),
        }),
      );
      toast.success("권리 요청을 기록하고 이미지를 즉시 블라인드했습니다.");
      setRationale("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "권리 요청 기록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(request: OpsMediaRightsRequest, result: "ACTIONED" | "DISMISSED") {
    const resolution = window.prompt("처리 결과를 10자 이상 입력해 주세요.");
    if (!resolution || resolution.trim().length < 10) return;
    try {
      await json(
        await fetch(`/api/ops/media-review/rights-requests/${request.id}/resolve`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: result, resolution: resolution.trim() }),
        }),
      );
      toast.success("권리 요청 처리 결과를 기록했습니다.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
    }
  }

  return (
    <section className={styles.page}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>MEDIA SAFETY</p>
          <h1>Issue 이미지 검수</h1>
        </div>
        <span>승인 전 비공개 · 모든 판단 이력 보존</span>
      </div>
      <div className={styles.filters}>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
        />
        <input
          value={rightsAttestation}
          onChange={(event) => setRightsAttestation(event.target.value)}
          placeholder="사용 권한·출처 근거 (20자 이상)"
        />
        <button type="button" disabled={busy} onClick={() => void upload()}>
          검수 큐 등록
        </button>
      </div>
      <form
        className={`${styles.filters} ${styles.editorialFilters}`}
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Asset ID, SHA-256, 권리 근거 검색"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">전체 상태</option>
          {["PENDING", "APPROVED", "REJECTED", "HIDDEN", "DELETED"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button type="submit">조회</button>
      </form>
      {page ? (
        <div className={styles.counts}>
          {Object.entries(page.counts).map(([key, value]) => (
            <article key={key}>
              <span>{key}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      ) : null}
      <div className={styles.editorialGrid}>
        <div className={styles.candidateList}>
          {page?.items.length ? (
            page.items.map((asset) => (
              <button
                className={styles.candidate}
                aria-pressed={asset.id === selected?.id}
                key={asset.id}
                onClick={() => setSelected(asset)}
              >
                <span className={styles.candidateMeta}>
                  <b>{asset.effectiveStatus}</b>
                  <span>{new Date(asset.createdAt).toLocaleDateString("ko-KR")}</span>
                </span>
                <strong>{asset.link?.question ?? "연결 전 이미지"}</strong>
                <small>{asset.id}</small>
              </button>
            ))
          ) : (
            <p className={styles.empty}>조건에 맞는 이미지가 없습니다.</p>
          )}
        </div>
        {selected ? (
          <article className={styles.detail}>
            {selected.effectiveStatus === "DELETED" ? (
              <div className={styles.mediaUnavailable} role="img" aria-label="삭제된 이미지">
                <strong>삭제된 이미지입니다.</strong>
                <span>파일은 영구 제거되었으며 판단 이력만 보존됩니다.</span>
              </div>
            ) : (
              <img
                className={styles.mediaPreview}
                src={`/api/ops/media-review/assets/${selected.id}/content`}
                alt={selected.link?.altText ?? "운영 검수 이미지"}
              />
            )}
            <p className={styles.eyebrow}>
              {selected.effectiveStatus} · {selected.rightsState}
            </p>
            <h2>{selected.link?.question ?? "Issue 연결 대기"}</h2>
            <p className={styles.context}>{selected.rightsAttestation}</p>
            <div className={styles.facts}>
              <span>{selected.uploadedBy}</span>
              <span>
                {selected.output.width}×{selected.output.height}
              </span>
              <span>{Math.round(selected.output.byteSize / 1024)} KB</span>
              <span>{policyVersion}</span>
            </div>
            <section className={styles.decision}>
              {selected.effectiveStatus === "DELETED" ? (
                <p className={styles.terminalNotice}>
                  삭제가 완료된 자산에는 추가 검수·권리 조작을 실행할 수 없습니다.
                </p>
              ) : (
                <>
                  <textarea
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    placeholder="검수 판단 또는 권리 요청 근거 (10자 이상)"
                  />
                  <div className={styles.decisionActions}>
                    {reviewActionsForStatus(selected.effectiveStatus).map((action) => (
                      <button key={action} disabled={busy} onClick={() => void decide(action)}>
                        {actionLabels[action]}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {selected.link && issueActionsForStatus(selected.effectiveStatus).length ? (
                <div className={styles.decisionActions}>
                  {issueActionsForStatus(selected.effectiveStatus).map((action) => (
                    <button
                      key={action}
                      disabled={busy}
                      onClick={() => void decide(action, "ISSUE")}
                    >
                      Issue 전체 {actionLabels[action]}
                    </button>
                  ))}
                </div>
              ) : null}
              {selected.effectiveStatus !== "DELETED" ? (
                <div className={styles.decisionActions}>
                  <button disabled={busy} onClick={() => void reportRights("PRIVACY")}>
                    개인정보 요청
                  </button>
                  <button disabled={busy} onClick={() => void reportRights("DEFAMATION")}>
                    명예훼손 요청
                  </button>
                  <button disabled={busy} onClick={() => void reportRights("COPYRIGHT")}>
                    저작권 요청
                  </button>
                </div>
              ) : null}
            </section>
            <h3>판단 이력</h3>
            <ul className={styles.sources}>
              {selected.history.map((decision) => (
                <li key={decision.id}>
                  <b>{decision.status}</b> · {decision.reasonCode} · {decision.reviewedBy}
                  <br />
                  {decision.rationale}
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </div>
      <section>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>RIGHTS DESK</p>
            <h2>개인정보·명예훼손·저작권 요청</h2>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>유형</th>
                <th>대상</th>
                <th>상태</th>
                <th>내용</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {rights.map((request) => (
                <tr key={request.id}>
                  <td>{request.requestType}</td>
                  <td>
                    <code>{request.assetId ?? request.issueId}</code>
                  </td>
                  <td>{request.status}</td>
                  <td>{request.details}</td>
                  <td>
                    {request.status === "OPEN" ? (
                      <>
                        <button onClick={() => void resolve(request, "ACTIONED")}>조치 완료</button>{" "}
                        <button onClick={() => void resolve(request, "DISMISSED")}>기각</button>
                      </>
                    ) : (
                      request.resolution
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
