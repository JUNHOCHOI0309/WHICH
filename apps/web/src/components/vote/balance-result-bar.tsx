import styles from "./vote-primitives.module.css";
import type { ChoiceCode, IssueChoice, IssueTally } from "@/lib/contracts";

export function BalanceResultBar({
  aLabel,
  bLabel,
  acceptedA,
  acceptedB,
  selectedChoice,
  compact = false,
  choices,
  result,
}: {
  aLabel?: string;
  bLabel?: string;
  acceptedA?: number;
  acceptedB?: number;
  selectedChoice: ChoiceCode;
  compact?: boolean;
  choices?: IssueChoice[];
  result?: IssueTally;
}) {
  const tallyByCode: Record<ChoiceCode, number> = {
    A: result?.acceptedA ?? acceptedA ?? 0,
    B: result?.acceptedB ?? acceptedB ?? 0,
    C: result?.acceptedC ?? 0,
    D: result?.acceptedD ?? 0,
  };
  const rows = choices?.length
    ? choices.map((choice) => ({
        code: choice.code,
        label: choice.label,
        count: tallyByCode[choice.code],
      }))
    : [
        { code: "A" as const, label: aLabel ?? "A", count: tallyByCode.A },
        { code: "B" as const, label: bLabel ?? "B", count: tallyByCode.B },
      ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const percentages = rows.map((row) => (total === 0 ? 0 : Math.round((row.count / total) * 100)));
  const aRatio = total === 0 ? 0.5 : tallyByCode.A / total;

  return (
    <section
      className={`${styles.result} ${compact ? styles.resultCompact : ""}`}
      aria-label={`투표 결과, ${rows.map((row, index) => `${row.code} ${percentages[index]}퍼센트`).join(", ")}`}
      aria-live="polite"
    >
      <div className={styles.resultChoices}>
        {rows.map((row, index) => (
          <ResultChoice
            key={row.code}
            {...row}
            percent={percentages[index] ?? 0}
            selected={selectedChoice === row.code}
            multi={rows.length > 2}
          />
        ))}
      </div>
      {rows.length === 2 ? (
        <div className={styles.balanceTrack} aria-hidden="true">
          <span className={styles.segmentA} style={{ width: `${aRatio * 100}%` }} />
          <span className={styles.segmentB} />
          <span className={styles.seam} style={{ left: `${aRatio * 100}%` }} />
        </div>
      ) : null}
      <p className={styles.resultTotal}>{total.toLocaleString("ko-KR")}명 참여</p>
    </section>
  );
}

function ResultChoice({
  code,
  label,
  count,
  percent,
  selected,
  multi,
}: {
  code: ChoiceCode;
  label: string;
  count: number;
  percent: number;
  selected: boolean;
  multi: boolean;
}) {
  return (
    <div className={`${styles.resultChoice} ${styles[`resultChoice${code}`]}`}>
      <div>
        <span className={styles.resultCode}>{selected ? "✓" : code}</span>
        <strong>{label}</strong>
        {selected ? <em>나의 선택</em> : null}
      </div>
      <b>{percent}%</b>
      <small>{count.toLocaleString("ko-KR")}표</small>
      {multi ? (
        <span className={styles.choiceResultTrack} aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </div>
  );
}
