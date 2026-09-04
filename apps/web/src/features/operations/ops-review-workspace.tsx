"use client";

import { useState } from "react";

import { OpsIssueReviewPanel } from "./ops-issue-review-panel";
import { OpsMediaReviewPanel } from "./ops-media-review-panel";
import styles from "./ops-management.module.css";

type ReviewLane = "issues" | "images";

export function OpsReviewWorkspace() {
  const [lane, setLane] = useState<ReviewLane>("issues");

  return (
    <section className={styles.reviewWorkspace}>
      <header className={styles.reviewWorkspaceHeader}>
        <div>
          <p className={styles.eyebrow}>REVIEW CENTER</p>
          <h1>질문과 이미지를 한 흐름에서 검토합니다.</h1>
          <span>
            질문의 편집 판단과 이미지의 안전·권리 판단은 각각 기록한 뒤 최종 게시 단계에서 함께
            확인합니다.
          </span>
        </div>
        <div className={styles.reviewLaneTabs} role="tablist" aria-label="검수 작업 선택">
          <button
            type="button"
            role="tab"
            aria-selected={lane === "issues"}
            onClick={() => setLane("issues")}
          >
            질문 검수
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={lane === "images"}
            onClick={() => setLane("images")}
          >
            이미지 검수
          </button>
        </div>
      </header>

      <div role="tabpanel" aria-label={lane === "issues" ? "질문 검수" : "이미지 검수"}>
        {lane === "issues" ? (
          <OpsIssueReviewPanel onOpenMediaReview={() => setLane("images")} embedded />
        ) : (
          <OpsMediaReviewPanel onBackToIssues={() => setLane("issues")} embedded />
        )}
      </div>
    </section>
  );
}
