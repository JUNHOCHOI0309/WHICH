import { useState } from "react";

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
  return (
    <button
      className={`${styles.choice} ${styles[`choice${choice.code}`]} ${selected ? styles.selected : ""}`}
      type="button"
      disabled={disabled}
      aria-label={`${choice.code} 선택, ${choice.label}`}
      aria-pressed={selected}
      onClick={() => onSelect(choice)}
    >
      <ChoiceMedia choice={choice} onMediaLoad={onMediaLoad} />
      <span className={styles.choiceCode}>{choice.code}</span>
      <span className={styles.choiceLabel}>{choice.label}</span>
      <span className={styles.choiceState} aria-hidden="true">
        {pending ? "…" : selected ? "✓" : "→"}
      </span>
    </button>
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
  const [failed, setFailed] = useState(false);
  if (!choice.media || failed) return null;
  return (
    <span className={styles.choiceMedia}>
      {/* Public Issue media uses a runtime-configured R2 domain, so the native element is intentional. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={choice.media.url}
        alt={choice.media.altText}
        width={choice.media.width}
        height={choice.media.height}
        loading="lazy"
        style={{ objectFit: choice.media.cropMode === "CONTAIN" ? "contain" : "cover" }}
        onLoad={() => onMediaLoad?.("SUCCESS")}
        onError={() => {
          setFailed(true);
          onMediaLoad?.("FAILURE");
        }}
      />
    </span>
  );
}
