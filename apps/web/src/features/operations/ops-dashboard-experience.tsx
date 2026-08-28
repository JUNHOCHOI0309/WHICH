"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { OpsDashboardSnapshot } from "./contracts";
import { OpsEditorialPanel } from "./ops-editorial-panel";
import { OpsMembersPanel } from "./ops-members-panel";
import { OpsMediaReviewPanel } from "./ops-media-review-panel";
import { OpsModerationQueuePanel } from "./ops-moderation-queue-panel";
import { OpsPointShopPanel } from "./ops-point-shop-panel";
import { OpsRankingPreviewPanel } from "./ops-ranking-preview-panel";
import styles from "./ops-dashboard-experience.module.css";

type WindowDays = 1 | 7 | 30;
type Screen = "loading" | "ready" | "login" | "denied" | "error";
type Tab = "overview" | "members" | "editorial" | "moderation" | "media" | "pointShop" | "ranking";

const stageLabels: Array<[keyof OpsDashboardSnapshot["funnel"]["stages"], string]> = [
  ["viewable", "Viewable"],
  ["submit", "Submit"],
  ["accepted", "Accepted"],
  ["result", "Result"],
  ["next", "Next"],
  ["secondVote", "Second Vote"],
];

const githubRoot = "https://github.com/JUNHOCHOI0309/WHICH/blob/main/";

function compact(value: number) {
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function percent(value: number) {
  return new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 1 }).format(
    value,
  );
}

function dateTime(value: string | null) {
  if (!value) return "확인 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationSeconds(value: number | null) {
  if (value === null) return "대기 없음";
  if (value < 60) return `${Math.round(value)}초`;
  if (value < 3600) return `${Math.round(value / 60)}분`;
  return `${(value / 3600).toFixed(1)}시간`;
}

export function OpsDashboardExperience() {
  const [tab, setTab] = useState<Tab>("overview");
  const [windowDays, setWindowDays] = useState<WindowDays>(7);
  const [screen, setScreen] = useState<Screen>("loading");
  const [snapshot, setSnapshot] = useState<OpsDashboardSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (days: WindowDays, background = false) => {
    if (background) setRefreshing(true);
    try {
      const response = await fetch(`/api/ops/dashboard?days=${days}`, { cache: "no-store" });
      const body = (await response.json()) as OpsDashboardSnapshot & {
        code?: string;
        message?: string;
      };
      if (response.status === 401) {
        setSnapshot(null);
        setScreen("login");
        return;
      }
      if (response.status === 403) {
        setSnapshot(null);
        setErrorMessage(body.message || "운영자 권한을 확인할 수 없습니다.");
        setScreen("denied");
        return;
      }
      if (!response.ok) throw new Error(body.message || "운영 스냅샷을 불러오지 못했습니다.");
      setSnapshot(body);
      setScreen("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "운영 스냅샷을 불러오지 못했습니다.",
      );
      if (!background) setScreen("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // The state updates inside load happen only after the remote snapshot request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(windowDays);
    const timer = window.setInterval(() => void load(windowDays, true), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load, windowDays]);

  const warningCounts = useMemo(() => {
    const values = { critical: 0, warning: 0 };
    for (const warning of snapshot?.warnings ?? []) {
      if (warning.severity === "CRITICAL") values.critical += 1;
      if (warning.severity === "WARNING") values.warning += 1;
    }
    return values;
  }, [snapshot]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="WHICH 홈">
          <span>W</span>HICH
        </Link>
        <div>
          <strong>OPS / CONTROLLED</strong>
          <span>운영자 전용</span>
        </div>
      </header>

      {screen !== "ready" || !snapshot ? (
        <section className={styles.state} aria-live="polite">
          <p>{screen === "loading" ? "LOADING SNAPSHOT" : "ACCESS CHECK"}</p>
          <h1>
            {screen === "loading"
              ? "운영 상태를 모으고 있어요."
              : screen === "login"
                ? "WHICH 로그인이 필요합니다."
                : screen === "denied"
                  ? "운영 콘솔에 접근할 수 없습니다."
                  : "운영 상태를 불러오지 못했습니다."}
          </h1>
          {screen !== "loading" ? <span>{errorMessage || "다시 시도해 주세요."}</span> : null}
          <div className={styles.stateActions}>
            {screen === "login" ? <Link href="/login?returnTo=%2Fops">로그인</Link> : null}
            {screen === "error" ? (
              <button
                type="button"
                onClick={() => {
                  setScreen("loading");
                  void load(windowDays);
                }}
              >
                다시 불러오기
              </button>
            ) : null}
            <Link href="/">홈으로</Link>
          </div>
        </section>
      ) : (
        <div className={styles.dashboard}>
          <nav className={styles.tabs} aria-label="운영 콘솔 메뉴">
            {(
              [
                ["overview", "Overview"],
                ["members", "사용자 DB"],
                ["editorial", "Issue Review"],
                ["moderation", "Moderation Queue"],
                ["media", "Image Review"],
                ["pointShop", "Point Shop"],
                ["ranking", "Ranking Preview"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-current={tab === value ? "page" : undefined}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "overview" ? (
            <>
              <section className={styles.hero}>
                <div>
                  <p>PRODUCTION PULSE</p>
                  <h1>지금 운영 상태를 한눈에 봅니다.</h1>
                  <span>
                    생성 {dateTime(snapshot.generatedAt)} · Analytics{" "}
                    {dateTime(snapshot.funnel.refreshedAt)}
                  </span>
                </div>
                <div className={styles.controls}>
                  <div className={styles.periods} aria-label="조회 기간">
                    {([1, 7, 30] as const).map((days) => (
                      <button
                        type="button"
                        key={days}
                        aria-pressed={windowDays === days}
                        onClick={() => {
                          setScreen("loading");
                          setWindowDays(days);
                        }}
                      >
                        {days}일
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={styles.refresh}
                    onClick={() => void load(windowDays, true)}
                    disabled={refreshing}
                  >
                    {refreshing ? "갱신 중" : "새로고침"}
                  </button>
                </div>
              </section>

              <section className={styles.summaryGrid} aria-label="핵심 운영 상태">
                <article>
                  <span>RELEASE</span>
                  <strong>{snapshot.system.releaseId.slice(0, 10)}</strong>
                  <small>
                    API {snapshot.system.apiReadiness} · migration{" "}
                    {snapshot.system.migrations.applied}
                  </small>
                </article>
                <article
                  className={snapshot.system.outbox.failed > 0 ? styles.dangerCard : undefined}
                >
                  <span>OUTBOX</span>
                  <strong>{snapshot.system.outbox.pending} pending</strong>
                  <small>
                    {snapshot.system.outbox.failed} failed · oldest{" "}
                    {durationSeconds(snapshot.system.outbox.oldestPendingAgeSeconds)}
                  </small>
                </article>
                <article
                  className={
                    warningCounts.critical > 0
                      ? styles.dangerCard
                      : warningCounts.warning > 0
                        ? styles.warningCard
                        : undefined
                  }
                >
                  <span>ATTENTION</span>
                  <strong>{warningCounts.critical} critical</strong>
                  <small>{warningCounts.warning} warning</small>
                </article>
                <article>
                  <span>BACKUP CONFIRM</span>
                  <strong>{snapshot.system.backup.lastConfirmedAt ? "recorded" : "missing"}</strong>
                  <small>{dateTime(snapshot.system.backup.lastConfirmedAt)}</small>
                </article>
              </section>

              {snapshot.warnings.length > 0 ? (
                <section className={styles.warnings} aria-labelledby="warning-title">
                  <div className={styles.sectionHeading}>
                    <div>
                      <p>NEEDS ATTENTION</p>
                      <h2 id="warning-title">먼저 확인할 항목</h2>
                    </div>
                    <span>{snapshot.warnings.length}건</span>
                  </div>
                  <ul>
                    {snapshot.warnings.map((warning) => (
                      <li key={warning.code} data-severity={warning.severity}>
                        <strong>{warning.severity}</strong>
                        <span>{warning.message}</span>
                        <code>{warning.code}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className={styles.panel} aria-labelledby="funnel-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p>OFFICIAL FUNNEL</p>
                    <h2 id="funnel-title">선택 흐름</h2>
                  </div>
                  <span>{snapshot.windowDays}일 · PRODUCT only</span>
                </div>
                <div className={styles.funnel}>
                  {stageLabels.map(([key, label], index) => (
                    <article key={key}>
                      <span>{label}</span>
                      <strong>{compact(snapshot.funnel.stages[key])}</strong>
                      {index > 0 ? (
                        <small>
                          {percent(
                            snapshot.funnel.stages[key] /
                              Math.max(1, snapshot.funnel.stages[stageLabels[index - 1]![0]]),
                          )}
                        </small>
                      ) : (
                        <small>공식 시작점</small>
                      )}
                    </article>
                  ))}
                </div>
                <div
                  className={styles.reconciliation}
                  data-status={snapshot.funnel.reconciliation.status}
                >
                  <div>
                    <span>VOTE RECONCILIATION</span>
                    <strong>{snapshot.funnel.reconciliation.status}</strong>
                  </div>
                  <p>
                    aggregate{" "}
                    {snapshot.funnel.reconciliation.aggregatedAcceptedVotes.toLocaleString("ko-KR")}{" "}
                    · source{" "}
                    {snapshot.funnel.reconciliation.sourceAcceptedVotes.toLocaleString("ko-KR")} ·
                    diff {snapshot.funnel.reconciliation.difference}
                  </p>
                </div>
              </section>

              <div className={styles.twoColumns}>
                <section className={styles.panel} aria-labelledby="supply-title">
                  <div className={styles.sectionHeading}>
                    <div>
                      <p>CONTENT SUPPLY</p>
                      <h2 id="supply-title">질문 공급</h2>
                    </div>
                    <span>{snapshot.content.editorial.ready ? "READY" : "CHECK"}</span>
                  </div>
                  <div className={styles.metricRows}>
                    <div>
                      <span>운영 DB 공개 가능</span>
                      <strong>{snapshot.content.production.eligibleIssues}</strong>
                    </div>
                    <div>
                      <span>무노출 질문</span>
                      <strong>{snapshot.content.production.zeroExposureIssues}</strong>
                    </div>
                    <div>
                      <span>Editorial Active</span>
                      <strong>{snapshot.content.editorial.activeIssues}</strong>
                    </div>
                    <div>
                      <span>Reserve</span>
                      <strong>{snapshot.content.editorial.reserveIssues}</strong>
                    </div>
                    <div>
                      <span>Long-term</span>
                      <strong>{snapshot.content.editorial.longTermIssues}</strong>
                    </div>
                  </div>
                  <div className={styles.supplyBars}>
                    <div>
                      <span>Active days</span>
                      <strong>{snapshot.content.editorial.activeDaysOfSupply.toFixed(1)}일</strong>
                    </div>
                    <div>
                      <span>Reserve days</span>
                      <strong>{snapshot.content.editorial.reserveDaysOfSupply.toFixed(1)}일</strong>
                    </div>
                  </div>
                  {snapshot.content.production.belowMinimumCategories.length > 0 ? (
                    <div className={styles.tags} aria-label="최소 수량 미달 카테고리">
                      {snapshot.content.production.belowMinimumCategories.map((category) => (
                        <span key={category.categoryCode}>
                          {category.categoryCode} {category.issues}/{category.minimum}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className={styles.panel} aria-labelledby="trust-title">
                  <div className={styles.sectionHeading}>
                    <div>
                      <p>TRUST & INTEGRITY</p>
                      <h2 id="trust-title">신뢰·검토 상태</h2>
                    </div>
                    <span>{snapshot.windowDays}일</span>
                  </div>
                  <div className={styles.metricRows}>
                    <div>
                      <span>신고</span>
                      <strong>{snapshot.trust.moderation.reports}</strong>
                    </div>
                    <div>
                      <span>검토 큐</span>
                      <strong>{snapshot.trust.moderation.queueSize}</strong>
                    </div>
                    <div>
                      <span>가장 오래된 큐</span>
                      <strong>{snapshot.trust.moderation.oldestQueueHours.toFixed(1)}h</strong>
                    </div>
                    <div>
                      <span>숨김 / 복구</span>
                      <strong>
                        {snapshot.trust.moderation.hidden} / {snapshot.trust.moderation.restored}
                      </strong>
                    </div>
                    <div>
                      <span>Vote review</span>
                      <strong>{snapshot.trust.integrity.reviewVotes}</strong>
                    </div>
                    <div>
                      <span>미완료 시도</span>
                      <strong>{snapshot.trust.integrity.incompleteVoteAttempts}</strong>
                    </div>
                  </div>
                  <div className={styles.integrityLine}>
                    <span>duplicate {snapshot.trust.integrity.rejectedDuplicateVotes}</span>
                    <span>abuse {snapshot.trust.integrity.rejectedAbuseVotes}</span>
                    <span>invalidated {snapshot.trust.integrity.invalidatedVotes}</span>
                    <span>rate-limit buckets {snapshot.trust.integrity.authRateLimitBuckets}</span>
                  </div>
                </section>
              </div>

              <section className={styles.footerPanel}>
                <div>
                  <p>FOLLOW-UP IS EXPLICIT</p>
                  <h2>변경 작업은 CLI와 런북에서 진행합니다.</h2>
                  <span>이 화면은 데이터를 수정하거나 재집계하지 않습니다.</span>
                </div>
                <nav aria-label="운영 런북">
                  {snapshot.runbooks.map((runbook) => (
                    <a
                      key={runbook.path}
                      href={`${githubRoot}${runbook.path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {runbook.label} ↗
                    </a>
                  ))}
                </nav>
              </section>
            </>
          ) : tab === "moderation" ? (
            <OpsModerationQueuePanel />
          ) : tab === "members" ? (
            <OpsMembersPanel />
          ) : tab === "editorial" ? (
            <OpsEditorialPanel />
          ) : tab === "media" ? (
            <OpsMediaReviewPanel />
          ) : tab === "pointShop" ? (
            <OpsPointShopPanel />
          ) : (
            <OpsRankingPreviewPanel />
          )}
        </div>
      )}
    </main>
  );
}
