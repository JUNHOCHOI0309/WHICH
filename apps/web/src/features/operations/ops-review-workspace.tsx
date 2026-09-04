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
          <h1>관리자 질문과 사용자 이미지를 분리해 검토합니다.</h1>
          <span>질문 검수는 관리자 콘텐츠, 이미지 검수는 외부 사용자의 업로드만 다룹니다.</span>
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
        {lane === "issues" ? <OpsIssueReviewPanel embedded /> : <OpsMediaReviewPanel embedded />}
      </div>
    </section>
  );
}
