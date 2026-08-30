import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

import type { IssueChoice } from "@/lib/contracts";

import styles from "./vote-primitives.module.css";

export function VoteChoiceRow({
  choice,
  selected = false,
  disabled = false,
  pending = false,
  onMediaLoad,
  onSelect,
}: {
  choice: IssueChoice;
  selected?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onMediaLoad?: (outcome: "SUCCESS" | "FAILURE") => void;
  onSelect: (choice: IssueChoice) => void;
}) {
  const voteButton = (
    <button
      className={`${styles.choice} ${styles[`choice${choice.code}`]} ${selected ? styles.selected : ""}`}
      type="button"
      disabled={disabled}
      aria-label={`${choice.code} 선택, ${choice.label}`}
      aria-pressed={selected}
      onClick={() => onSelect(choice)}
    >
      <span className={styles.choiceCode}>{choice.code}</span>
      <span className={styles.choiceLabel}>{choice.label}</span>
      <span className={styles.choiceState} aria-hidden="true">
        {pending ? "…" : selected ? "✓" : "→"}
      </span>
    </button>
  );
  if (!choice.media) return voteButton;
  return (
    <div
      className={`${styles.imageChoice} ${styles[`choice${choice.code}`]} ${selected ? styles.selected : ""}`}
    >
      <ChoiceMedia choice={choice} onMediaLoad={onMediaLoad} />
      {voteButton}
    </div>
  );
}

export function ChoiceMediaPair({
  choices,
  onMediaLoad,
}: {
  choices: IssueChoice[];
  onMediaLoad?: (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => void;
}) {
  if (choices.length !== 2 || choices.some((choice) => !choice.media)) return null;
  return (
    <div className={styles.mediaPair}>
      {choices.map((choice) => (
        <div className={styles.mediaResult} key={choice.id}>
          <ChoiceMedia choice={choice} onMediaLoad={(outcome) => onMediaLoad?.(choice, outcome)} />
          <span>
            {choice.code} · {choice.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChoiceMedia({
  choice,
  onMediaLoad,
}: {
  choice: IssueChoice;
  onMediaLoad?: (outcome: "SUCCESS" | "FAILURE") => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const media = choice.media;
  if (!media || failedUrl === media.url) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.choiceMedia}
        aria-label={`${choice.code} 이미지 확대, ${media.altText}`}
        aria-haspopup="dialog"
        onClick={() => setPreviewUrl(media.url)}
      >
        {/* Public Issue media uses a runtime-configured R2 domain, so the native element is intentional. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.altText}
          width={media.width}
          height={media.height}
          loading="lazy"
          decoding="async"
          onLoad={() => onMediaLoad?.("SUCCESS")}
          onError={() => {
            setFailedUrl(media.url);
            onMediaLoad?.("FAILURE");
          }}
        />
        <span className={styles.mediaExpandHint} aria-hidden="true">
          확대 보기 ↗
        </span>
      </button>
      {previewUrl === media.url ? (
        <MediaPreview
          media={media}
          returnFocusTo={triggerRef}
          onClose={() => setPreviewUrl(null)}
        />
      ) : null}
    </>
  );
}

function MediaPreview({
  media,
  returnFocusTo,
  onClose,
}: {
  media: NonNullable<IssueChoice["media"]>;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = returnFocusTo.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);
  return createPortal(
    <dialog
      ref={ref}
      className={styles.mediaDialog}
      aria-label="이미지 전체 보기"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className={styles.mediaDialogClose}
        onClick={onClose}
        aria-label="이미지 확대 닫기"
      >
        닫기 ×
      </button>
      {failed ? (
        <p role="status">이미지를 불러오지 못했어요. 닫고 다시 시도해 주세요.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={media.altText}
          width={media.width}
          height={media.height}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </dialog>,
    document.body,
  );
}
