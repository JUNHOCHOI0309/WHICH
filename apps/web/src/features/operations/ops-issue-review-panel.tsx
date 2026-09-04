"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { OpsEditorialPanel } from "./ops-editorial-panel";
import styles from "./ops-management.module.css";

const OpsPublishedIssuesPanel = dynamic(
  () => import("./ops-published-issues-panel").then((module) => module.OpsPublishedIssuesPanel),
  { loading: () => <p className={styles.empty}>게시 질문 관리 도구를 불러오고 있습니다.</p> },
);

export function OpsIssueReviewPanel({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const [mode, setMode] = useState<"candidates" | "published">("candidates");

  return (
    <>
      <nav className={styles.reviewModeTabs} aria-label="Issue Review 범위">
        <button
          type="button"
          aria-pressed={mode === "candidates"}
          onClick={() => setMode("candidates")}
        >
          검수 후보
        </button>
        <button
          type="button"
          aria-pressed={mode === "published"}
          onClick={() => setMode("published")}
        >
          게시된 질문
        </button>
      </nav>
      {mode === "candidates" ? (
        <OpsEditorialPanel embedded={embedded} onPublished={() => setMode("published")} />
      ) : (
        <OpsPublishedIssuesPanel />
      )}
    </>
  );
}
