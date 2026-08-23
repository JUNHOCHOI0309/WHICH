import styles from "./vote-primitives.module.css";

export function BalanceResultBar({
  aLabel,
  bLabel,
  acceptedA,
  acceptedB,
  selectedChoice,
  compact = false,
}: {
  aLabel: string;
  bLabel: string;
  acceptedA: number;
  acceptedB: number;
  selectedChoice: "A" | "B";
  compact?: boolean;
}) {
  const total = acceptedA + acceptedB;
  const aRatio = total === 0 ? 0.5 : acceptedA / total;
  const aPercent = total === 0 ? 0 : Math.round(aRatio * 100);
  const bPercent = total === 0 ? 0 : 100 - aPercent;

  return (
    <section
      className={`${styles.result} ${compact ? styles.resultCompact : ""}`}
      aria-label={`투표 결과, A ${aPercent}퍼센트, B ${bPercent}퍼센트`}
      aria-live="polite"
    >
      <div className={styles.resultChoices}>
        <ResultChoice
          code="A"
          label={aLabel}
          count={acceptedA}
          percent={aPercent}
          selected={selectedChoice === "A"}
        />
        <ResultChoice
          code="B"
          label={bLabel}
          count={acceptedB}
          percent={bPercent}
          selected={selectedChoice === "B"}
        />
      </div>
      <div className={styles.balanceTrack} aria-hidden="true">
        <span className={styles.segmentA} style={{ width: `${aRatio * 100}%` }} />
        <span className={styles.segmentB} />
        <span className={styles.seam} style={{ left: `${aRatio * 100}%` }} />
      </div>
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
}: {
  code: "A" | "B";
  label: string;
  count: number;
  percent: number;
  selected: boolean;
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
    </div>
  );
}
