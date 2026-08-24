"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { CreateIssueCommand, InterestCardRegistry } from "@/lib/contracts";

import { createMemberIssue, loadIssueCreationContext } from "./issue-creator-client";
import styles from "./issue-creator-experience.module.css";

const DRAFT_KEY = "which_issue_draft_v1";
const EMPTY_DRAFT: CreateIssueCommand = {
  question: "",
  context: "",
  choiceA: "",
  choiceB: "",
  interestCardCode: "DAILY_LIFE",
};

function initialDraft() {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  const saved = window.sessionStorage.getItem(DRAFT_KEY);
  if (!saved) return EMPTY_DRAFT;
  try {
    return { ...EMPTY_DRAFT, ...(JSON.parse(saved) as Partial<CreateIssueCommand>) };
  } catch {
    window.sessionStorage.removeItem(DRAFT_KEY);
    return EMPTY_DRAFT;
  }
}

export function IssueCreatorExperience() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "guest" | "member" | "error">("loading");
  const [registry, setRegistry] = useState<InterestCardRegistry | null>(null);
  const [draft, setDraft] = useState<CreateIssueCommand>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingKey = useRef<string | null>(null);

  useEffect(() => {
    void loadIssueCreationContext()
      .then((context) => {
        if (!context.authenticated) {
          setState("guest");
          return;
        }
        setRegistry(context.registry);
        setState("member");
      })
      .catch(() => setState("error"));
  }, []);

  const update = <K extends keyof CreateIssueCommand>(key: K, value: CreateIssueCommand[K]) => {
    setError(null);
    setDraft((current) => {
      const next = { ...current, [key]: value };
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
    pendingKey.current = null;
  };

  if (state === "loading") {
    return <section className={styles.panel}>질문 작성 환경을 준비하는 중…</section>;
  }

  if (state === "guest") {
    return (
      <section className={`${styles.panel} ${styles.guestPanel}`}>
        <p className={styles.eyebrow}>MEMBER CREATION</p>
        <h1>질문은 Member가 만들 수 있어요.</h1>
        <p>
          작성 중인 내용은 이 브라우저에 잠시 보관됩니다. 로그인하거나 빠르게 가입한 뒤 그대로
          이어서 작성하세요.
        </p>
        <Link className={styles.primaryLink} href="/login?returnTo=%2Fcreate">
          로그인하고 질문 만들기 <span aria-hidden="true">→</span>
        </Link>
      </section>
    );
  }

  if (state === "error" || !registry) {
    return (
      <section className={styles.panel}>
        질문 작성 환경을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </section>
    );
  }

  const selectedLabel =
    registry.cards.find((card) => card.code === draft.interestCardCode)?.label ?? "생활";

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        pendingKey.current ??= crypto.randomUUID();
        void createMemberIssue(draft, pendingKey.current)
          .then((result) => {
            window.sessionStorage.removeItem(DRAFT_KEY);
            router.push(`/issues/${result.issue.id}`);
          })
          .catch((reason) => {
            const status =
              typeof reason === "object" && reason !== null && "status" in reason
                ? Number(reason.status)
                : 0;
            if (status === 401) setState("guest");
            setError(reason instanceof Error ? reason.message : "질문을 만들지 못했습니다.");
          })
          .finally(() => setSubmitting(false));
      }}
    >
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>CREATE YOUR CHOICE</p>
            <h1>사람들에게 어떤 선택을 물어볼까요?</h1>
          </div>
          <span>24시간 최대 3개</span>
        </div>

        <label className={styles.field}>
          <span>질문</span>
          <input
            value={draft.question}
            onChange={(event) => update("question", event.target.value)}
            maxLength={120}
            placeholder="예: 퇴근 후 바로 잘까, 조금 더 놀까?"
            required
          />
          <small>
            {Array.from(draft.question).length}/120 · 물음표는 빠져 있어도 자동으로 붙여드려요.
          </small>
        </label>

        <label className={styles.field}>
          <span>
            짧은 설명 <em>선택</em>
          </span>
          <textarea
            value={draft.context ?? ""}
            onChange={(event) => update("context", event.target.value)}
            maxLength={240}
            placeholder="선택할 때 생각해 볼 상황을 한 줄로 덧붙여 보세요."
          />
          <small>{Array.from(draft.context ?? "").length}/240</small>
        </label>

        <div className={styles.choiceGrid}>
          <label className={styles.choiceField} data-side="A">
            <span>
              <b>A</b> 첫 번째 선택
            </span>
            <input
              value={draft.choiceA}
              onChange={(event) => update("choiceA", event.target.value)}
              maxLength={50}
              placeholder="바로 자기"
              required
            />
          </label>
          <label className={styles.choiceField} data-side="B">
            <span>
              <b>B</b> 두 번째 선택
            </span>
            <input
              value={draft.choiceB}
              onChange={(event) => update("choiceB", event.target.value)}
              maxLength={50}
              placeholder="조금 더 놀기"
              required
            />
          </label>
        </div>

        <fieldset className={styles.categories}>
          <legend>관심 주제</legend>
          <div>
            {registry.cards.map((card) => (
              <label key={card.code}>
                <input
                  type="radio"
                  name="interest-card"
                  checked={draft.interestCardCode === card.code}
                  onChange={() => update("interestCardCode", card.code)}
                />
                <span>{card.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={`${styles.panel} ${styles.preview}`} aria-label="질문 미리보기">
        <div className={styles.previewMeta}>
          <span>PREVIEW</span>
          <b>{selectedLabel}</b>
        </div>
        <h2>{draft.question.trim() || "질문이 여기에 표시됩니다."}</h2>
        {draft.context?.trim() ? <p>{draft.context}</p> : null}
        <div className={styles.previewChoice} data-side="A">
          <b>A</b>
          <span>{draft.choiceA || "첫 번째 선택"}</span>
        </div>
        <div className={styles.previewChoice} data-side="B">
          <b>B</b>
          <span>{draft.choiceB || "두 번째 선택"}</span>
        </div>
      </section>

      <div className={styles.submitBar}>
        <p>공개 후 바로 피드에 표시됩니다. 링크·정치·고위험 주제는 v1에서 게시할 수 없어요.</p>
        <button type="submit" disabled={submitting}>
          {submitting ? "게시하는 중…" : "질문 게시하기"}
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
