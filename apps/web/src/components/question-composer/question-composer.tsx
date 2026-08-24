"use client";

import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { IssueCreatorExperience } from "@/features/issues/issue-creator-experience";

import styles from "./question-composer.module.css";

type QuestionComposerContextValue = {
  isOpen: boolean;
  openComposer: () => void;
};

const QuestionComposerContext = createContext<QuestionComposerContextValue | null>(null);

function removeComposeQuery() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("compose") !== "question") return;
  url.searchParams.delete("compose");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function QuestionComposerProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openComposer = useCallback(() => {
    if (!enabled) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
  }, [enabled]);

  const closeComposer = useCallback(() => {
    setIsOpen(false);
    removeComposeQuery();
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!enabled || new URL(window.location.href).searchParams.get("compose") !== "question")
      return;
    const timer = window.setTimeout(openComposer, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, openComposer]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <QuestionComposerContext.Provider value={{ isOpen, openComposer }}>
      {children}
      {isOpen ? (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeComposer();
          }}
        >
          <div
            ref={dialogRef}
            id="question-composer-dialog"
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-composer-title"
            onKeyDown={handleDialogKeyDown}
          >
            <header className={styles.header}>
              <div>
                <span>NEW QUESTION</span>
                <h2 id="question-composer-title">Question</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.closeButton}
                aria-label="Question 작성 창 닫기"
                onClick={closeComposer}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className={styles.body}>
              <IssueCreatorExperience presentation="modal" />
            </div>
          </div>
        </div>
      ) : null}
    </QuestionComposerContext.Provider>
  );
}

export function useQuestionComposer() {
  const value = useContext(QuestionComposerContext);
  if (!value) throw new Error("Question Composer must be used inside its provider.");
  return value;
}
