import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";
import type { ChoiceCode, IssueChoice, IssueTally } from "@/contracts";

export function BalanceResultBar({
  aLabel,
  bLabel,
  acceptedA,
  acceptedB,
  selectedChoice,
  choices,
  result,
}: {
  aLabel?: string;
  bLabel?: string;
  acceptedA?: number;
  acceptedB?: number;
  selectedChoice: ChoiceCode;
  choices?: IssueChoice[];
  result?: IssueTally;
}) {
  const counts: Record<ChoiceCode, number> = {
    A: result?.acceptedA ?? acceptedA ?? 0,
    B: result?.acceptedB ?? acceptedB ?? 0,
    C: result?.acceptedC ?? 0,
    D: result?.acceptedD ?? 0,
  };
  const rows = choices?.length
    ? choices.map((choice) => ({ ...choice, count: counts[choice.code] }))
    : [
        { id: "A", code: "A" as const, label: aLabel ?? "A", media: null, count: counts.A },
        { id: "B", code: "B" as const, label: bLabel ?? "B", media: null, count: counts.B },
      ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const percentages = rows.map((row) => (total === 0 ? 0 : Math.round((row.count / total) * 100)));
  const aRatio = total === 0 ? 0.5 : counts.A / total;

  return (
    <View
      accessible
      accessibilityLabel={`투표 결과, ${rows.map((row, index) => `${row.code} ${percentages[index]}퍼센트`).join(", ")}`}
      style={styles.result}
    >
      <View style={[styles.labels, rows.length > 2 && styles.labelsMulti]}>
        {rows.map((row, index) => (
          <View style={styles.labelSide} key={row.code}>
            <Text numberOfLines={2} style={styles.choiceLabel}>
              {selectedChoice === row.code ? "✓ " : `${row.code} · `}
              {row.label}
            </Text>
            <Text style={[styles.choicePercent, { color: choiceColor(row.code) }]}>
              {percentages[index]}%
            </Text>
            <Text style={styles.count}>{row.count.toLocaleString("ko-KR")}표</Text>
            {rows.length > 2 ? (
              <View style={styles.choiceTrack}>
                <View
                  style={[
                    styles.choiceFill,
                    {
                      backgroundColor: choiceColor(row.code),
                      width: `${percentages[index] ?? 0}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {rows.length === 2 ? (
        <View style={styles.track}>
          <View style={[styles.trackA, { width: `${aRatio * 100}%` }]} />
          <View style={[styles.seam, { left: `${aRatio * 100}%` }]} />
        </View>
      ) : null}
      <Text style={styles.total}>{total.toLocaleString("ko-KR")}명 참여</Text>
    </View>
  );
}

function choiceColor(code: ChoiceCode) {
  return code === "A"
    ? colors.cyanStrong
    : code === "B"
      ? colors.orangeStrong
      : code === "C"
        ? "#8467D7"
        : "#5D9C59";
}

const styles = StyleSheet.create({
  result: { gap: 11 },
  labels: { flexDirection: "row", gap: 14 },
  labelsMulti: { flexWrap: "wrap" },
  labelSide: { flexBasis: "45%", flexGrow: 1, gap: 3 },
  labelSideB: { alignItems: "flex-end" },
  aLabel: { color: colors.text, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  bLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "right",
  },
  aPercent: { color: colors.cyanStrong, fontSize: 23, fontWeight: "900" },
  bPercent: { color: colors.orangeStrong, fontSize: 23, fontWeight: "900" },
  count: { color: colors.textTertiary, fontSize: 11 },
  choiceLabel: { color: colors.text, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  choicePercent: { fontSize: 23, fontWeight: "900" },
  choiceTrack: { backgroundColor: colors.border, borderRadius: 999, height: 6, overflow: "hidden" },
  choiceFill: { borderRadius: 999, height: "100%" },
  track: {
    backgroundColor: colors.orange,
    borderRadius: 999,
    height: 9,
    overflow: "visible",
    position: "relative",
  },
  trackA: {
    backgroundColor: colors.cyan,
    borderBottomLeftRadius: 999,
    borderTopLeftRadius: 999,
    height: "100%",
  },
  seam: {
    backgroundColor: colors.text,
    borderColor: colors.surface,
    borderRadius: 999,
    borderWidth: 2,
    height: 18,
    marginLeft: -3,
    position: "absolute",
    top: -4.5,
    width: 6,
  },
  total: { color: colors.textSecondary, fontSize: 12, textAlign: "right" },
});
