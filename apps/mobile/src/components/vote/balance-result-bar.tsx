import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";

export function BalanceResultBar({
  aLabel,
  bLabel,
  acceptedA,
  acceptedB,
  selectedChoice,
}: {
  aLabel: string;
  bLabel: string;
  acceptedA: number;
  acceptedB: number;
  selectedChoice: "A" | "B";
}) {
  const total = acceptedA + acceptedB;
  const aRatio = total === 0 ? 0.5 : acceptedA / total;
  const aPercent = total === 0 ? 0 : Math.round(aRatio * 100);
  const bPercent = total === 0 ? 0 : 100 - aPercent;

  return (
    <View
      accessible
      accessibilityLabel={`투표 결과, A ${aPercent}퍼센트, B ${bPercent}퍼센트`}
      style={styles.result}
    >
      <View style={styles.labels}>
        <View style={styles.labelSide}>
          <Text numberOfLines={2} style={styles.aLabel}>
            {selectedChoice === "A" ? "✓ " : "A · "}
            {aLabel}
          </Text>
          <Text style={styles.aPercent}>{aPercent}%</Text>
          <Text style={styles.count}>{acceptedA.toLocaleString("ko-KR")}표</Text>
        </View>
        <View style={[styles.labelSide, styles.labelSideB]}>
          <Text numberOfLines={2} style={styles.bLabel}>
            {selectedChoice === "B" ? "✓ " : "B · "}
            {bLabel}
          </Text>
          <Text style={styles.bPercent}>{bPercent}%</Text>
          <Text style={styles.count}>{acceptedB.toLocaleString("ko-KR")}표</Text>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackA, { width: `${aRatio * 100}%` }]} />
        <View style={[styles.seam, { left: `${aRatio * 100}%` }]} />
      </View>
      <Text style={styles.total}>{total.toLocaleString("ko-KR")}명 참여</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  result: { gap: 11 },
  labels: { flexDirection: "row", gap: 14 },
  labelSide: { flex: 1, gap: 3 },
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
