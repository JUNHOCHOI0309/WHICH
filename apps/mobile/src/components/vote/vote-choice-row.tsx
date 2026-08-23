import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { IssueChoice } from "@/contracts";
import { colors } from "@/theme";

export function VoteChoiceRow({
  choice,
  selected = false,
  disabled = false,
  pending = false,
  onPress,
}: {
  choice: IssueChoice;
  selected?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onPress: (choice: IssueChoice) => void;
}) {
  const isB = choice.code === "B";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${choice.code} 선택, ${choice.label}`}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => onPress(choice)}
      style={({ pressed }) => [
        styles.row,
        isB ? styles.rowB : styles.rowA,
        selected && (isB ? styles.selectedB : styles.selectedA),
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.code, isB ? styles.codeB : styles.codeA]}>
        <Text style={styles.codeText}>{choice.code}</Text>
      </View>
      <Text style={styles.label}>{choice.label}</Text>
      {pending ? (
        <ActivityIndicator color={isB ? colors.orangeStrong : colors.cyanStrong} size="small" />
      ) : (
        <Text style={[styles.arrow, isB ? styles.arrowB : styles.arrowA]}>
          {selected ? "✓" : "→"}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rowA: { borderColor: "#8EDCE6" },
  rowB: { borderColor: "#FFB79C" },
  selectedA: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  selectedB: { backgroundColor: colors.orangeSoft, borderColor: colors.orange },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  code: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  codeA: { borderColor: colors.cyan },
  codeB: { borderColor: colors.orange },
  codeText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  label: { color: colors.text, flex: 1, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  arrow: { fontSize: 18, fontWeight: "900" },
  arrowA: { color: colors.cyanStrong },
  arrowB: { color: colors.orangeStrong },
});
