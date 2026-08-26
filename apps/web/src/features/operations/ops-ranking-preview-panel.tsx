"use client";

import { useCallback, useEffect, useState } from "react";

import type { OpsRankingPreview } from "./contracts";
import styles from "./ops-management.module.css";

function componentSummary(components: Record<string, number>) {
  return Object.entries(components)
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ");
}

export function OpsRankingPreviewPanel() {
  const [preview, setPreview] = useState<OpsRankingPreview | null>(null);
  const [message, setMessage] = useState("추천 감사 데이터를 불러오고 있습니다.");

  const load = useCallback(async () => {
    const response = await fetch("/api/ops/ranking-preview?limit=50", { cache: "no-store" });
    const body = (await response.json()) as OpsRankingPreview & { message?: string };
    if (!response.ok) throw new Error(body.message || "추천 미리보기를 불러오지 못했습니다.");
    setPreview(body);
  }, []);

  useEffect(() => {
    // State changes happen only after the remote operator request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "추천 미리보기를 불러오지 못했습니다."),
    );
  }, [load]);

  return (
    <section className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>QUALITY FEED · EXPLAINABLE</p>
          <h1>추천 순위 미리보기</h1>
        </div>
        <span>
          {preview ? `${preview.configuredMode} · ${preview.policyVersion}` : "불러오는 중"}
        </span>
      </header>
      <div className={styles.notice}>
        SHADOW에서는 실제 노출 순서(served)와 품질 순위(shadow)를 함께 저장합니다. LIVE 전환은
        skip·report·Vote→Next 기준을 검토한 뒤 진행하세요.
      </div>
      {!preview || preview.items.length === 0 ? (
        <p className={styles.empty}>{preview ? "아직 추천 감사 데이터가 없습니다." : message}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>순위</th>
                <th>질문</th>
                <th>후보 출처</th>
                <th>점수 구성</th>
                <th>정책 판정</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <tr key={`${item.requestId}:${item.servedPosition}`}>
                  <td>
                    served {item.servedPosition}
                    <br />
                    shadow {item.shadowPosition ?? "-"}
                  </td>
                  <td className={styles.identity}>
                    <strong>{item.question}</strong>
                    <code>
                      {item.categoryCode} · {item.issueId.slice(0, 8)}
                    </code>
                  </td>
                  <td>
                    {item.candidateSources.map((source) => (
                      <span className={styles.provider} key={source}>
                        {source}
                      </span>
                    ))}
                  </td>
                  <td>
                    <strong>{item.qualityScore}</strong>
                    <br />
                    <small>{componentSummary(item.scoreComponents)}</small>
                  </td>
                  <td>
                    <span
                      className={styles.badge}
                      data-status={item.qualityEligible ? "ACTIVE" : "SUSPENDED"}
                    >
                      {item.qualityEligible ? "ELIGIBLE" : "EXCLUDED"}
                    </span>
                    {item.controversyEligible ? (
                      <span className={styles.provider}>CONTROVERSY</span>
                    ) : null}
                    <small>
                      {item.eligibilityReasons.join(", ") ||
                        item.fallbackReason ||
                        item.rankingReason}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
