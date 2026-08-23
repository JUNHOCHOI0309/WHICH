import type { IssueChoice } from "@/lib/contracts";

import styles from "./vote-primitives.module.css";

export function VoteChoiceRow({
  choice,
  selected = false,
  disabled = false,
  pending = false,
  onSelect,
}: {
  choice: IssueChoice;
  selected?: boolean;
  disabled?: boolean;
  pending?: boolean;
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
      <span className={styles.choiceCode}>{choice.code}</span>
      <span className={styles.choiceLabel}>{choice.label}</span>
      <span className={styles.choiceState} aria-hidden="true">
        {pending ? "…" : selected ? "✓" : "→"}
      </span>
    </button>
  );
}
