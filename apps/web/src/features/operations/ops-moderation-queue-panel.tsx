"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";

import type {
  OpsModerationQueueItem,
  OpsModerationQueueLane,
  OpsModerationQueuePage,
} from "./contracts";
import styles from "./ops-management.module.css";

const lanes: Array<[OpsModerationQueueLane | "", string]> = [
  ["", "전체 Lane"],
  ["HIGH", "High"],
  ["NORMAL", "Normal"],
  ["RIGHTS", "Rights"],
  ["APPEAL", "Appeal"],
  ["RANDOM_AUDIT", "Random Audit"],
];

function formatDuration(value: number | null) {
  if (value === null) return "기록 없음";
  if (value < 60) return `${Math.round(value)}초`;
  if (value < 3600) return `${Math.round(value / 60)}분`;
  return `${(value / 3600).toFixed(1)}시간`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "운영 요청에 실패했습니다.");
  return body;
}

export function OpsModerationQueuePanel() {
  const [page, setPage] = useState<OpsModerationQueuePage | null>(null);
  const [lane, setLane] = useState<OpsModerationQueueLane | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => page?.items.find((item) => item.caseId === selectedId) ?? page?.items[0] ?? null,
    [page, selectedId],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "25" });
    if (lane) params.set("lane", lane);
    const result = await json<OpsModerationQueuePage>(
      await fetch(`/api/ops/moderation-queue?${params}`, { cache: "no-store" }),
    );
    setPage(result);
    setSelectedId((current) =>
      result.items.some((item) => item.caseId === current)
        ? current
        : (result.items[0]?.caseId ?? null),
    );
  }, [lane]);

  useEffect(() => {
    // State is updated only after the remote Queue request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((error) =>
      toast.error(error instanceof Error ? error.message : "예외 Queue를 불러오지 못했습니다."),
    );
  }, [load]);

  async function recordView(
    item: OpsModerationQueueItem,
    eventType: "CASE_VIEWED" | "ASSET_REVEALED" | "ORIGINAL_VIEWED",
  ) {
    await fetch(`/api/ops/moderation-queue/${item.caseId}/views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType }),
    });
  }

  async function reveal(item: OpsModerationQueueItem) {
    setRevealed(true);
    await recordView(item, "ASSET_REVEALED");
  }

  async function decide(action: string) {
    if (!selected || rationale.trim().length < 10)
      return toast.error("판단 근거를 10자 이상 입력해 주세요.");
    setBusy(true);
    try {
      await json(
        await fetch(`/api/ops/moderation-queue/${selected.caseId}/decision`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: selected.expectedRevision,
            action,
            reasonCode: "OPS_EXCEPTION_REVIEW",
            rationale: rationale.trim(),
            policyVersion: "ops-moderation-queue-v1",
          }),
        }),
      );
      toast.success("예외 Case 판정을 기록했습니다.");
      setRationale("");
      setRevealed(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "판정을 기록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const actions =
    selected?.context.kind === "IMAGE"
      ? ["APPROVED", "REJECTED", "HIDDEN", "DELETED"]
      : ["COLLAPSE", "HIDE", "REMOVE_POLICY", "RESTORE"];

  return (
    <section className={styles.page}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>EXCEPTION FOCUSED</p>
          <h1>Moderation Queue</h1>
        </div>
        <span>고위험·불확실·권리·이의제기·Random Audit만 운영자가 확인합니다.</span>
      </div>

      <div className={styles.filters}>
        <select
          value={lane}
          onChange={(event) => setLane(event.target.value as OpsModerationQueueLane | "")}
        >
          {lanes.map(([value, label]) => (
            <option key={value || "ALL"} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void load()}>
          새로고침
        </button>
      </div>

      {page ? (
        <>
          <div className={styles.counts}>
            <article>
              <span>QUEUE</span>
              <strong>{page.metrics.queueCount}</strong>
            </article>
            <article>
              <span>OLDEST</span>
              <strong>{formatDuration(page.metrics.oldestAgeSeconds)}</strong>
            </article>
            <article>
              <span>REVIEW P50 / P95</span>
              <strong>
                {formatDuration(page.metrics.reviewSecondsP50)} /{" "}
                {formatDuration(page.metrics.reviewSecondsP95)}
              </strong>
            </article>
            <article>
              <span>WEEKLY HOURS</span>
              <strong>{page.metrics.weeklyOperatorHours.toFixed(1)}h</strong>
            </article>
            <article>
              <span>INFLOW / OUTFLOW 7D</span>
              <strong>
                {page.metrics.inflow7d} / {page.metrics.outflow7d}
              </strong>
            </article>
          </div>

          <section className={styles.moderationHealth} aria-label="AI Moderation 운영 안전">
            <div className={styles.sectionTitle}>
              <div>
                <p className={styles.eyebrow}>PROVIDER &amp; WORKER SAFETY</p>
                <h2>Shadow 운영 상태</h2>
              </div>
              <span>
                직접 업로드 {page.operational.directUploadAllowed ? "허용 가능" : "일시 중지 권고"}
              </span>
            </div>
            <div className={styles.counts}>
              <article>
                <span>MODE / CIRCUIT</span>
                <strong>
                  {page.operational.provider.mode} · {page.operational.provider.circuitState}
                </strong>
              </article>
              <article>
                <span>CALLS TODAY / CAP</span>
                <strong>
                  {page.operational.provider.callsToday} / {page.operational.provider.dailyCallCap}
                </strong>
              </article>
              <article>
                <span>ERROR / CACHE HIT 7D</span>
                <strong>
                  {formatPercent(page.operational.provider.errorRate7d)} /{" "}
                  {formatPercent(page.operational.provider.cacheHitRate7d)}
                </strong>
              </article>
              <article>
                <span>P95 / COVERAGE 7D</span>
                <strong>
                  {page.operational.provider.latencyP95Ms === null
                    ? "기록 없음"
                    : `${Math.round(page.operational.provider.latencyP95Ms)}ms`}{" "}
                  {" · "}
                  {formatPercent(page.operational.provider.automationCoverage7d)}
                </strong>
              </article>
              <article>
                <span>WORKER PENDING / DEAD</span>
                <strong>
                  {page.operational.worker.pending} / {page.operational.worker.deadLettered}
                </strong>
              </article>
              <article>
                <span>R2·DB·CDN MISMATCH / FAIL</span>
                <strong>
                  {page.operational.reconciliation.mismatches} /{" "}
                  {page.operational.reconciliation.failed}
                </strong>
              </article>
            </div>
            {page.operational.alerts.length > 0 ? (
              <ul className={styles.operationalAlerts}>
                {page.operational.alerts.map((alert) => (
                  <li key={alert.code} data-severity={alert.severity}>
                    <strong>{alert.severity}</strong>
                    <span>{alert.message}</span>
                    <code>{alert.code}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.operationalClear}>
                현재 Queue·비용·저장소 경계 경고가 없습니다.
              </p>
            )}
          </section>
        </>
      ) : null}

      <div className={styles.editorialGrid}>
        <div className={styles.candidateList}>
          {page?.items.length ? (
            page.items.map((item) => (
              <button
                type="button"
                className={styles.candidate}
                aria-pressed={item.caseId === selected?.caseId}
                key={item.caseId}
                onClick={() => {
                  setSelectedId(item.caseId);
                  setRevealed(false);
                  void recordView(item, "CASE_VIEWED");
                }}
              >
                <span className={styles.candidateMeta}>
                  <b>
                    {item.lane} · {item.priority}
                  </b>
                  <span>rev {item.expectedRevision}</span>
                </span>
                <strong>{item.summary}</strong>
                <small>{item.targetType}</small>
              </button>
            ))
          ) : (
            <p className={styles.empty}>현재 조건의 예외 Case가 없습니다.</p>
          )}
        </div>

        {selected ? (
          <article className={styles.detail}>
            <p className={styles.eyebrow}>
              {selected.lane} · {selected.targetType} · REV {selected.expectedRevision}
            </p>
            <h2>{selected.summary}</h2>
            {selected.context.kind === "IMAGE" ? (
              <>
                <div
                  className={styles.moderationMediaFrame}
                  data-blurred={selected.risky && !revealed}
                >
                  <img
                    className={styles.mediaPreview}
                    src={`/api/ops/media-review/assets/${selected.context.assetId}/content`}
                    alt={
                      selected.context.choices.find(
                        (choice) => choice.assetId === selected.targetId,
                      )?.altText ?? "검수 이미지"
                    }
                  />
                  {selected.risky && !revealed ? (
                    <button type="button" onClick={() => void reveal(selected)}>
                      민감 이미지 보기
                    </button>
                  ) : null}
                </div>
                <div className={styles.choices}>
                  {selected.context.choices.map((choice) => (
                    <div key={choice.code}>
                      <b>{choice.code}</b>
                      <span>
                        {choice.label} · alt: {choice.altText ?? "없음"} · crop:{" "}
                        {choice.cropMode ?? "없음"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className={styles.context}>
                  권리: {selected.context.rightsState} · {selected.context.rightsAttestation}
                </p>
                <h3>Rule findings</h3>
                <ul className={styles.sources}>
                  {(selected.context.findings ?? []).map((finding) => (
                    <li key={finding.id}>
                      <b>{finding.severity}</b> · {finding.stage} · {finding.code}
                      <br />
                      {finding.sourceVersion} · {JSON.stringify(finding.evidence)}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => void recordView(selected, "ORIGINAL_VIEWED")}
                >
                  원본 열람 기록
                </button>
                <h3>이전 판단</h3>
                <ul className={styles.sources}>
                  {selected.context.priorDecisions.map((decision) => (
                    <li key={decision.id}>
                      <b>{decision.status}</b> · {decision.reasonCode} · {decision.reviewedBy}
                      <br />
                      {decision.rationale}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className={styles.context}>{selected.context.body}</p>
                <div className={styles.facts}>
                  <span>{selected.context.authorDisplayName}</span>
                  <span>신고 {selected.context.reporterCount}명</span>
                  <span>점수 {selected.context.reportScore}</span>
                  <span>{selected.context.visibility}</span>
                </div>
              </>
            )}
            <section className={styles.decision}>
              <textarea
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="판단 근거 (10자 이상)"
              />
              <div className={styles.decisionActions}>
                {actions?.map((action) => (
                  <button
                    type="button"
                    key={action}
                    disabled={busy}
                    onClick={() => void decide(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>
              <small>
                일괄·비가역 작업은 제공하지 않으며 expectedRevision 충돌 시 다시 불러옵니다.
              </small>
            </section>
          </article>
        ) : null}
      </div>
    </section>
  );
}
